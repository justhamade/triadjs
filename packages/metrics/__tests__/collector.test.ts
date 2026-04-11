import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsCollector } from '../src/index.js';
import type { MetricsCollector } from '../src/index.js';

describe('createMetricsCollector', () => {
  let collector: MetricsCollector;
  beforeEach(() => {
    collector = createMetricsCollector();
  });

  it('records a request into counter and histogram', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.012,
    });
    const snap = collector.snapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.series).toHaveLength(1);
    const series = snap.series[0]!;
    expect(series.count).toBe(1);
    expect(series.sum).toBeCloseTo(0.012);
  });

  it('creates distinct series per label combination', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.01,
    });
    collector.recordRequest({
      method: 'POST',
      route: '/books',
      endpointName: 'createBook',
      context: 'Library',
      status: 201,
      latencySeconds: 0.02,
    });
    collector.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.03,
    });
    const snap = collector.snapshot();
    expect(snap.series).toHaveLength(2);
    const listSeries = snap.series.find((s) => s.labels['method'] === 'GET')!;
    expect(listSeries.count).toBe(2);
    expect(listSeries.sum).toBeCloseTo(0.04);
  });

  it('increments error counter when error flag is set', () => {
    collector.recordRequest({
      method: 'POST',
      route: '/books',
      endpointName: 'createBook',
      context: 'Library',
      status: 500,
      latencySeconds: 0.05,
      error: true,
    });
    const snap = collector.snapshot();
    expect(snap.totalErrors).toBe(1);
    const series = snap.series[0]!;
    expect(series.errorCount).toBe(1);
  });

  it('builds cumulative histogram buckets', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.003,
    });
    collector.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.02,
    });
    collector.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 2,
    });
    const series = collector.snapshot().series[0]!;
    // bucket counts should be monotonically non-decreasing
    let prev = 0;
    for (const [, count] of series.buckets) {
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
    // final (+Inf implied) total = 3
    expect(series.count).toBe(3);
    // 0.005 bucket: contains only 0.003
    const b005 = series.buckets.find(([le]) => le === 0.005)!;
    expect(b005[1]).toBe(1);
    // 0.025 bucket: contains 0.003 and 0.02
    const b025 = series.buckets.find(([le]) => le === 0.025)!;
    expect(b025[1]).toBe(2);
  });

  it('reset() clears all state', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    collector.reset();
    const snap = collector.snapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.series).toHaveLength(0);
  });

  it('renders valid Prometheus text format', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/books',
      endpointName: 'listBooks',
      context: 'Library',
      status: 200,
      latencySeconds: 0.01,
    });
    const text = collector.render();
    expect(text).toContain('# HELP triad_http_requests_total');
    expect(text).toContain('# TYPE triad_http_requests_total counter');
    expect(text).toContain('# TYPE triad_http_request_duration_seconds histogram');
    expect(text).toContain('triad_http_requests_total{');
    expect(text).toMatch(/triad_http_request_duration_seconds_bucket\{[^}]*le="\+Inf"\}/);
    expect(text).toContain('triad_http_request_duration_seconds_sum{');
    expect(text).toContain('triad_http_request_duration_seconds_count{');
  });

  it('escapes label values per Prometheus spec', () => {
    collector.recordRequest({
      method: 'GET',
      route: '/a\\b"c\nd',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    const text = collector.render();
    // backslash -> \\, double-quote -> \", newline -> \n
    expect(text).toContain('route="/a\\\\b\\"c\\nd"');
  });

  it('honors namespace option for metric prefix', () => {
    const c = createMetricsCollector({ namespace: 'myapp' });
    c.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    const text = c.render();
    expect(text).toContain('myapp_http_requests_total');
    expect(text).toContain('myapp_http_request_duration_seconds');
    expect(text).not.toContain('triad_http_requests_total');
  });

  it('caps cardinality at maxCardinality and routes overflow to __other__', () => {
    const c = createMetricsCollector({ maxCardinality: 2 });
    c.recordRequest({
      method: 'GET',
      route: '/a',
      endpointName: 'a',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    c.recordRequest({
      method: 'GET',
      route: '/b',
      endpointName: 'b',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    c.recordRequest({
      method: 'GET',
      route: '/c',
      endpointName: 'c',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    c.recordRequest({
      method: 'GET',
      route: '/d',
      endpointName: 'd',
      context: '',
      status: 200,
      latencySeconds: 0.01,
    });
    const snap = c.snapshot();
    // 2 original series + 1 __other__ overflow
    expect(snap.series).toHaveLength(3);
    const other = snap.series.find((s) => s.labels['route'] === '__other__')!;
    expect(other.count).toBe(2);
  });

  it('uses custom latency buckets when provided', () => {
    const c = createMetricsCollector({ latencyBuckets: [0.1, 0.5, 1] });
    c.recordRequest({
      method: 'GET',
      route: '/x',
      endpointName: 'x',
      context: '',
      status: 200,
      latencySeconds: 0.2,
    });
    const s = c.snapshot().series[0]!;
    const les = s.buckets.map(([le]) => le);
    expect(les).toEqual([0.1, 0.5, 1]);
    expect(s.buckets.find(([le]) => le === 0.1)![1]).toBe(0);
    expect(s.buckets.find(([le]) => le === 0.5)![1]).toBe(1);
  });
});
