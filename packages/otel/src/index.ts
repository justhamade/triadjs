/**
 * @triadjs/otel — OpenTelemetry instrumentation for Triad routers.
 *
 * Drop-in wrapper that walks a router's endpoints and channels and
 * replaces their handlers with span-creating versions. See
 * `withOtelInstrumentation` for usage.
 */

export {
  withOtelInstrumentation,
  type OtelInstrumentationOptions,
} from './wrap-router.js';
