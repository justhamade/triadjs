/**
 * In-memory Prometheus-compatible metrics collector.
 *
 * Holds three families of metrics keyed by the label tuple
 * `(method, route, status, context)`:
 *
 *   - `<ns>_http_requests_total`           (counter)
 *   - `<ns>_http_request_duration_seconds` (histogram)
 *   - `<ns>_http_request_errors_total`     (counter)
 *
 * Plus optional channel metrics when the router wrapper is asked to
 * instrument channel handlers:
 *
 *   - `<ns>_channel_message_duration_seconds` (histogram, labels: channel, messageType)
 *
 * Everything is rendered as Prometheus text exposition format via
 * `render()`. The collector has zero runtime dependencies and is safe
 * to construct at module load time.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricsCollectorOptions = {
  /** Histogram buckets in seconds. Default: Prometheus-standard HTTP latency. */
  latencyBuckets?: readonly number[];
  /**
   * Maximum number of distinct HTTP label combinations retained. Further
   * combinations fall into a single `route="__other__"` bucket.
   * Default: 1000.
   */
  maxCardinality?: number;
  /** Include the endpoint path in labels. Default: true. */
  includePath?: boolean;
  /** Namespace prefix for all metric names. Default: 'triad'. */
  namespace?: string;
};

export type RequestMeta = {
  method: string;
  route: string;
  endpointName: string;
  context: string;
  status: number;
  latencySeconds: number;
  error?: boolean;
};

export type ChannelMessageMeta = {
  channel: string;
  messageType: string;
  context: string;
  latencySeconds: number;
  error?: boolean;
};

/**
 * One observation of an endpoint's `beforeHandler` phase. Reported as
 * a dedicated histogram family (`<ns>_http_before_handler_duration_seconds`)
 * with the `outcome` label set to `'ok'` (passed through to the main
 * handler), `'shortcircuit'` (returned `{ ok: false }`), or `'error'`
 * (threw). Short-circuits still contribute `latency_seconds` so the
 * auth path's p99 is visible in the same dashboard as the handler's.
 */
export type BeforeHandlerMeta = {
  method: string;
  route: string;
  endpointName: string;
  context: string;
  latencySeconds: number;
  outcome: 'ok' | 'shortcircuit' | 'error';
};

export type SeriesSnapshot = {
  labels: Readonly<Record<string, string>>;
  count: number;
  sum: number;
  buckets: ReadonlyArray<readonly [number, number]>;
  errorCount: number;
};

export type MetricsSnapshot = {
  totalRequests: number;
  totalErrors: number;
  series: SeriesSnapshot[];
};

export type MetricsCollector = {
  recordRequest: (meta: RequestMeta) => void;
  recordChannelMessage: (meta: ChannelMessageMeta) => void;
  recordBeforeHandler: (meta: BeforeHandlerMeta) => void;
  render: () => string;
  reset: () => void;
  snapshot: () => MetricsSnapshot;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const DEFAULT_MAX_CARDINALITY = 1000;
const DEFAULT_NAMESPACE = 'triad';
const OVERFLOW_ROUTE = '__other__';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type HttpLabels = {
  method: string;
  route: string;
  status: string;
  context: string;
};

type HttpSeries = {
  labels: HttpLabels;
  count: number;
  sum: number;
  bucketCounts: number[];
  errorCount: number;
};

type ChannelLabels = {
  channel: string;
  messageType: string;
  context: string;
};

type ChannelSeries = {
  labels: ChannelLabels;
  count: number;
  sum: number;
  bucketCounts: number[];
};

type BeforeHandlerLabels = {
  method: string;
  route: string;
  context: string;
  outcome: 'ok' | 'shortcircuit' | 'error';
};

type BeforeHandlerSeriesEntry = {
  labels: BeforeHandlerLabels;
  count: number;
  sum: number;
  bucketCounts: number[];
};

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

function escapeLabelValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\') {
      out += '\\\\';
    } else if (ch === '"') {
      out += '\\"';
    } else if (ch === '\n') {
      out += '\\n';
    } else {
      out += ch;
    }
  }
  return out;
}

function formatLabels(entries: ReadonlyArray<readonly [string, string]>): string {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    parts.push(`${key}="${escapeLabelValue(value)}"`);
  }
  return parts.length === 0 ? '' : `{${parts.join(',')}}`;
}

function httpLabelEntries(l: HttpLabels): ReadonlyArray<readonly [string, string]> {
  return [
    ['method', l.method],
    ['route', l.route],
    ['status', l.status],
    ['context', l.context],
  ];
}

function httpLabelEntriesNoStatus(
  l: HttpLabels,
): ReadonlyArray<readonly [string, string]> {
  return [
    ['method', l.method],
    ['route', l.route],
    ['context', l.context],
  ];
}

function channelLabelEntries(
  l: ChannelLabels,
): ReadonlyArray<readonly [string, string]> {
  return [
    ['channel', l.channel],
    ['messageType', l.messageType],
    ['context', l.context],
  ];
}

function beforeHandlerLabelEntries(
  l: BeforeHandlerLabels,
): ReadonlyArray<readonly [string, string]> {
  return [
    ['method', l.method],
    ['route', l.route],
    ['context', l.context],
    ['outcome', l.outcome],
  ];
}

function seriesKey(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([k, v]) => `${k}=${v}`).join('|');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetricsCollector(
  options: MetricsCollectorOptions = {},
): MetricsCollector {
  const buckets = [...(options.latencyBuckets ?? DEFAULT_BUCKETS)].sort(
    (a, b) => a - b,
  );
  const maxCardinality = options.maxCardinality ?? DEFAULT_MAX_CARDINALITY;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;

  const httpSeries = new Map<string, HttpSeries>();
  const channelSeries = new Map<string, ChannelSeries>();
  const beforeHandlerSeries = new Map<string, BeforeHandlerSeriesEntry>();
  let totalRequests = 0;
  let totalErrors = 0;
  let warnedOverflow = false;

  function newBucketCounts(): number[] {
    return new Array(buckets.length).fill(0);
  }

  function observeBuckets(counts: number[], latencySeconds: number): void {
    for (let i = 0; i < buckets.length; i += 1) {
      const le = buckets[i]!;
      if (latencySeconds <= le) {
        counts[i] = (counts[i] ?? 0) + 1;
      }
    }
  }

  function getOrCreateHttpSeries(labels: HttpLabels): HttpSeries | undefined {
    const key = seriesKey(httpLabelEntries(labels));
    const existing = httpSeries.get(key);
    if (existing) return existing;
    if (httpSeries.size >= maxCardinality) {
      // Overflow: redirect to __other__ bucket keyed only by method+status+context
      const overflowLabels: HttpLabels = {
        method: labels.method,
        route: OVERFLOW_ROUTE,
        status: labels.status,
        context: labels.context,
      };
      const overflowKey = seriesKey(httpLabelEntries(overflowLabels));
      const existingOverflow = httpSeries.get(overflowKey);
      if (existingOverflow) return existingOverflow;
      if (!warnedOverflow) {
        warnedOverflow = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[@triad/metrics] cardinality cap (${maxCardinality}) reached; further routes will be bucketed as route="${OVERFLOW_ROUTE}"`,
        );
      }
      const created: HttpSeries = {
        labels: overflowLabels,
        count: 0,
        sum: 0,
        bucketCounts: newBucketCounts(),
        errorCount: 0,
      };
      httpSeries.set(overflowKey, created);
      return created;
    }
    const created: HttpSeries = {
      labels,
      count: 0,
      sum: 0,
      bucketCounts: newBucketCounts(),
      errorCount: 0,
    };
    httpSeries.set(key, created);
    return created;
  }

  function getOrCreateChannelSeries(labels: ChannelLabels): ChannelSeries {
    const key = seriesKey(channelLabelEntries(labels));
    const existing = channelSeries.get(key);
    if (existing) return existing;
    const created: ChannelSeries = {
      labels,
      count: 0,
      sum: 0,
      bucketCounts: newBucketCounts(),
    };
    channelSeries.set(key, created);
    return created;
  }

  function recordRequest(meta: RequestMeta): void {
    const labels: HttpLabels = {
      method: meta.method,
      route: meta.route,
      status: String(meta.status),
      context: meta.context,
    };
    const series = getOrCreateHttpSeries(labels);
    if (!series) return;
    series.count += 1;
    series.sum += meta.latencySeconds;
    observeBuckets(series.bucketCounts, meta.latencySeconds);
    if (meta.error === true) {
      series.errorCount += 1;
      totalErrors += 1;
    }
    totalRequests += 1;
  }

  function getOrCreateBeforeHandlerSeries(
    labels: BeforeHandlerLabels,
  ): BeforeHandlerSeriesEntry {
    const key = seriesKey(beforeHandlerLabelEntries(labels));
    const existing = beforeHandlerSeries.get(key);
    if (existing) return existing;
    const created: BeforeHandlerSeriesEntry = {
      labels,
      count: 0,
      sum: 0,
      bucketCounts: newBucketCounts(),
    };
    beforeHandlerSeries.set(key, created);
    return created;
  }

  function recordBeforeHandler(meta: BeforeHandlerMeta): void {
    const series = getOrCreateBeforeHandlerSeries({
      method: meta.method,
      route: meta.route,
      context: meta.context,
      outcome: meta.outcome,
    });
    series.count += 1;
    series.sum += meta.latencySeconds;
    observeBuckets(series.bucketCounts, meta.latencySeconds);
  }

  function recordChannelMessage(meta: ChannelMessageMeta): void {
    const labels: ChannelLabels = {
      channel: meta.channel,
      messageType: meta.messageType,
      context: meta.context,
    };
    const series = getOrCreateChannelSeries(labels);
    series.count += 1;
    series.sum += meta.latencySeconds;
    observeBuckets(series.bucketCounts, meta.latencySeconds);
  }

  function reset(): void {
    httpSeries.clear();
    channelSeries.clear();
    beforeHandlerSeries.clear();
    totalRequests = 0;
    totalErrors = 0;
    warnedOverflow = false;
  }

  function snapshot(): MetricsSnapshot {
    const series: SeriesSnapshot[] = [];
    const sorted = [...httpSeries.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      const snapBuckets: Array<readonly [number, number]> = [];
      let cumulative = 0;
      for (let i = 0; i < buckets.length; i += 1) {
        cumulative = s.bucketCounts[i] ?? 0;
        snapBuckets.push([buckets[i]!, cumulative] as const);
      }
      series.push({
        labels: {
          method: s.labels.method,
          route: s.labels.route,
          status: s.labels.status,
          context: s.labels.context,
        },
        count: s.count,
        sum: s.sum,
        buckets: snapBuckets,
        errorCount: s.errorCount,
      });
    }
    return { totalRequests, totalErrors, series };
  }

  function renderHttpCounter(lines: string[]): void {
    const name = `${namespace}_http_requests_total`;
    lines.push(`# HELP ${name} Total number of HTTP requests received`);
    lines.push(`# TYPE ${name} counter`);
    const sorted = [...httpSeries.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      lines.push(`${name}${formatLabels(httpLabelEntries(s.labels))} ${s.count}`);
    }
  }

  function renderHttpHistogram(lines: string[]): void {
    const name = `${namespace}_http_request_duration_seconds`;
    lines.push(`# HELP ${name} HTTP request latency in seconds`);
    lines.push(`# TYPE ${name} histogram`);
    const sorted = [...httpSeries.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      const baseLabels = httpLabelEntries(s.labels);
      for (let i = 0; i < buckets.length; i += 1) {
        const le = buckets[i]!;
        const count = s.bucketCounts[i] ?? 0;
        const bucketLabels: ReadonlyArray<readonly [string, string]> = [
          ...baseLabels,
          ['le', formatFloat(le)],
        ];
        lines.push(`${name}_bucket${formatLabels(bucketLabels)} ${count}`);
      }
      // +Inf bucket = total count
      const infLabels: ReadonlyArray<readonly [string, string]> = [
        ...baseLabels,
        ['le', '+Inf'],
      ];
      lines.push(`${name}_bucket${formatLabels(infLabels)} ${s.count}`);
      lines.push(`${name}_sum${formatLabels(baseLabels)} ${s.sum}`);
      lines.push(`${name}_count${formatLabels(baseLabels)} ${s.count}`);
    }
  }

  function renderHttpErrors(lines: string[]): void {
    const seriesWithErrors = [...httpSeries.entries()].filter(
      ([, s]) => s.errorCount > 0,
    );
    if (seriesWithErrors.length === 0) return;
    const name = `${namespace}_http_request_errors_total`;
    lines.push(`# HELP ${name} Total number of HTTP requests that threw`);
    lines.push(`# TYPE ${name} counter`);
    const sorted = seriesWithErrors.sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      lines.push(
        `${name}${formatLabels(httpLabelEntriesNoStatus(s.labels))} ${s.errorCount}`,
      );
    }
  }

  function renderChannelHistogram(lines: string[]): void {
    if (channelSeries.size === 0) return;
    const name = `${namespace}_channel_message_duration_seconds`;
    lines.push(`# HELP ${name} Channel message handler latency in seconds`);
    lines.push(`# TYPE ${name} histogram`);
    const sorted = [...channelSeries.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      const baseLabels = channelLabelEntries(s.labels);
      for (let i = 0; i < buckets.length; i += 1) {
        const le = buckets[i]!;
        const count = s.bucketCounts[i] ?? 0;
        lines.push(
          `${name}_bucket${formatLabels([
            ...baseLabels,
            ['le', formatFloat(le)],
          ])} ${count}`,
        );
      }
      lines.push(
        `${name}_bucket${formatLabels([...baseLabels, ['le', '+Inf']])} ${s.count}`,
      );
      lines.push(`${name}_sum${formatLabels(baseLabels)} ${s.sum}`);
      lines.push(`${name}_count${formatLabels(baseLabels)} ${s.count}`);
    }
  }

  function renderBeforeHandlerHistogram(lines: string[]): void {
    if (beforeHandlerSeries.size === 0) return;
    const name = `${namespace}_http_before_handler_duration_seconds`;
    lines.push(`# HELP ${name} Endpoint beforeHandler phase latency in seconds`);
    lines.push(`# TYPE ${name} histogram`);
    const sorted = [...beforeHandlerSeries.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    for (const [, s] of sorted) {
      const baseLabels = beforeHandlerLabelEntries(s.labels);
      for (let i = 0; i < buckets.length; i += 1) {
        const le = buckets[i]!;
        const count = s.bucketCounts[i] ?? 0;
        lines.push(
          `${name}_bucket${formatLabels([
            ...baseLabels,
            ['le', formatFloat(le)],
          ])} ${count}`,
        );
      }
      lines.push(
        `${name}_bucket${formatLabels([...baseLabels, ['le', '+Inf']])} ${s.count}`,
      );
      lines.push(`${name}_sum${formatLabels(baseLabels)} ${s.sum}`);
      lines.push(`${name}_count${formatLabels(baseLabels)} ${s.count}`);
    }
  }

  function render(): string {
    const lines: string[] = [];
    if (httpSeries.size > 0) {
      renderHttpCounter(lines);
      lines.push('');
      renderHttpHistogram(lines);
      const anyErrors = [...httpSeries.values()].some((s) => s.errorCount > 0);
      if (anyErrors) {
        lines.push('');
        renderHttpErrors(lines);
      }
    }
    if (beforeHandlerSeries.size > 0) {
      if (lines.length > 0) lines.push('');
      renderBeforeHandlerHistogram(lines);
    }
    if (channelSeries.size > 0) {
      if (lines.length > 0) lines.push('');
      renderChannelHistogram(lines);
    }
    if (lines.length === 0) return '';
    return `${lines.join('\n')}\n`;
  }

  return {
    recordRequest,
    recordChannelMessage,
    recordBeforeHandler,
    render,
    reset,
    snapshot,
  };
}

function formatFloat(n: number): string {
  // Prometheus expects floats without locale formatting. Use default
  // JS stringification which produces e.g. "0.005", "10".
  return String(n);
}

/**
 * Convenience wrapper — returns the Prometheus text for a collector.
 * Equivalent to `collector.render()` but exported so users can treat
 * it as a top-level function in adapter-level wire-ups.
 */
export function renderMetrics(collector: MetricsCollector): string {
  return collector.render();
}
