# @triadjs/metrics

Zero-dependency Prometheus metrics instrumentation for Triad routers. Drop-in wrapper that records histograms and counters for every endpoint handler, then renders them in the Prometheus text exposition format.

## Install

```bash
npm install @triadjs/metrics
```

`@triadjs/metrics` has **no runtime dependencies**. The collector, router wrapper, and text renderer are hand-rolled and total under 500 lines.

## Usage

The package exposes three things:

1. **`createMetricsCollector(options?)`** — an in-memory collector holding counters and histograms.
2. **`withMetricsInstrumentation(router, collector, options?)`** — a router-level wrapper that walks every endpoint and replaces the handler with one that records a request into the collector.
3. **`renderMetrics(collector)`** — a convenience helper that returns the Prometheus text for the collector. Equivalent to `collector.render()`.

```ts
import { createRouter } from '@triadjs/core';
import {
  createMetricsCollector,
  withMetricsInstrumentation,
  renderMetrics,
} from '@triadjs/metrics';

const router = createRouter({ title: 'My API', version: '1.0.0' });
router.add(/* ...endpoints... */);

const collector = createMetricsCollector({
  namespace: 'myapp',
  maxCardinality: 2000,
});

withMetricsInstrumentation(router, collector);
```

## Exposing `/metrics` — adapter wire-up

**v1 limitation.** Triad endpoints respond with JSON by default, and the response schema system does not yet model arbitrary `Content-Type` headers. Prometheus scrapers expect `text/plain; version=0.0.4`, so `/metrics` cannot be expressed as a regular Triad endpoint today. Instead, wire it up directly against the underlying HTTP framework after you register the Triad plugin. A future phase may add response content-type support to `@triadjs/core`.

### Fastify

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';

const app = Fastify();
await app.register(triadPlugin, { router });

app.get('/metrics', async (_req, reply) => {
  reply.type('text/plain; version=0.0.4');
  return renderMetrics(collector);
});
```

### Express

```ts
import express from 'express';
import { triadMiddleware } from '@triadjs/express';

const app = express();
app.use(triadMiddleware({ router }));

app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(renderMetrics(collector));
});
```

### Hono

```ts
import { Hono } from 'hono';
import { triadHandler } from '@triadjs/hono';

const app = new Hono();
app.route('/', triadHandler({ router }));

app.get('/metrics', (c) =>
  c.text(renderMetrics(collector), 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  }),
);
```

## Metrics reference

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `<ns>_http_requests_total` | counter | `method`, `route`, `status`, `context` | Total HTTP requests received. |
| `<ns>_http_request_duration_seconds` | histogram | `method`, `route`, `status`, `context` | Latency distribution. |
| `<ns>_http_request_errors_total` | counter | `method`, `route`, `context` | Requests whose handler threw. Only emitted when non-zero. |
| `<ns>_channel_message_duration_seconds` | histogram | `channel`, `messageType`, `context` | Channel message handler latency (only when `instrumentChannels: true`). |

The default namespace is `triad`. Pass `{ namespace: 'myapp' }` to override.

`route` is the **pattern** (e.g. `/books/:bookId`), never the resolved path, so path parameters cannot blow up cardinality on their own.

### Default histogram buckets

```
[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
```

Pass `{ latencyBuckets: [...] }` to override. Buckets are in seconds and are automatically sorted ascending.

## Cardinality protection

`maxCardinality` (default `1000`) caps the number of distinct HTTP label combinations the collector will retain. Once the cap is hit, further *new* combinations are merged into a single overflow series with `route="__other__"` (preserving `method`, `status`, and `context` labels). A warning is logged once via `console.warn`. This prevents memory exhaustion if you accidentally wire up high-cardinality routes.

Existing series continue to record normally — only genuinely new combinations spill over.

## Channel instrumentation

Channels are **not** instrumented by default. To opt in:

```ts
withMetricsInstrumentation(router, collector, { instrumentChannels: true });
```

When enabled, every per-message handler on every channel is wrapped with a timing recorder that emits into `<ns>_channel_message_duration_seconds` with `channel`, `messageType`, and `context` labels.

## Limitations (v1)

- **Text format only.** OpenMetrics and Protobuf exposition formats are not implemented — Prometheus scrapers accept text by default, so this is not a blocker.
- **`/metrics` wired at the adapter layer.** See above. Triad's response schemas do not yet model non-JSON bodies, so the metrics endpoint cannot be a Triad endpoint.
- **Process metrics not included.** CPU, memory, GC, file descriptor counts, and other Node-level metrics are out of scope — use a sibling package like `prom-client`'s `collectDefaultMetrics()` on the same `/metrics` route if you need them.
- **No exemplars.** Histogram bucket samples do not carry trace IDs yet.
- **Channel instrumentation is opt-in.** Default is HTTP-only because channels introduce an extra metric family that most users won't scrape.

## Related

- [`@triadjs/otel`](../otel/README.md) — OpenTelemetry instrumentation. Pairs well with metrics: OTel gives you traces and contextual attributes, `@triadjs/metrics` gives you fast scrapeable histograms.
- `docs/guides/observability.md` — the broader observability story for Triad.
