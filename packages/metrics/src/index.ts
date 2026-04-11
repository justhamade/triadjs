/**
 * @triad/metrics — Prometheus metrics instrumentation for Triad routers.
 *
 * Exposes a zero-dependency in-memory collector plus a router wrapper
 * that mutates endpoint handlers to measure per-request latency and
 * status. Users wire the `/metrics` scrape endpoint directly into
 * their HTTP adapter because Triad does not currently model non-JSON
 * responses.
 *
 * See README for usage.
 */

export {
  createMetricsCollector,
  renderMetrics,
  type MetricsCollector,
  type MetricsCollectorOptions,
  type MetricsSnapshot,
  type SeriesSnapshot,
  type RequestMeta,
  type ChannelMessageMeta,
  type BeforeHandlerMeta,
} from './collector.js';

export {
  withMetricsInstrumentation,
  type MetricsInstrumentationOptions,
} from './wrap-router.js';
