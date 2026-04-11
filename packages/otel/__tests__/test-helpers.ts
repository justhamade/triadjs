/**
 * Test helpers for the in-memory span exporter and a fresh tracer
 * provider per test. The provider is reset in `beforeEach` so spans
 * from one test don't leak into another.
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';

export interface OtelTestHarness {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
  spans: () => ReadableSpan[];
  reset: () => void;
}

export function createOtelHarness(): OtelTestHarness {
  // Always disable any previously-registered global provider, otherwise
  // `setGlobalTracerProvider` becomes a no-op on the second test and we
  // end up wrapping the router with a stale tracer that exports to an
  // old harness the current test can no longer see.
  trace.disable();
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return {
    exporter,
    provider,
    spans: () => exporter.getFinishedSpans(),
    reset: () => exporter.reset(),
  };
}
