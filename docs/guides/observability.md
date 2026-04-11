# Observability cookbook

> **Audience:** you've shipped a Triad service, traffic is real, and now
> something is slow or broken and you need to know why. This guide shows
> you how to wire up OpenTelemetry traces in 15 minutes, how to pair
> Triad with the major observability backends, and how to debug the
> common "I set everything up but I don't see any spans" problems.

## 1. Why observability matters

Without traces, metrics, and logs, a production outage is a guessing
game. You look at the CPU graph, you look at the error rate, you squint
at the logs, and you make a hypothesis. With observability wired up, an
outage is a short investigation: click the slow request in your trace
viewer, see the exact handler, see the exact downstream call, see the
exact database query, fix it, ship.

Triad does not build an observability stack itself. Instead it plugs
into the **OpenTelemetry** ecosystem — the open standard that every
major APM vendor now speaks. `@triad/otel` is a thin wrapper that
automatically instruments every endpoint, beforeHandler, channel
handler, and channel onConnect in your router with spans tagged from
the router's own metadata. Pair it with an OpenTelemetry SDK and an
exporter for your vendor of choice and you're done.

The value proposition of a declarative framework like Triad shows up
here too: because Triad knows the name, method, path, bounded context,
and response schema of every endpoint, the instrumentation can produce
consistently-tagged spans without any per-handler boilerplate. You
write `withOtelInstrumentation(router)` once and every future endpoint
you add is automatically traced with the same conventions.

## 2. The three pillars and what Triad gives you for each

Observability is traditionally split into three pillars. Triad
contributes to each one differently — some pieces are shipped today,
some are planned. Be honest with yourself about what you have wired up
before you assume you're covered.

| Pillar       | Triad's contribution                                                                                                              | External tool                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Traces**   | `@triad/otel` auto-instruments every endpoint, beforeHandler, channel handler, and onConnect with spans tagged from router metadata | OpenTelemetry SDK + exporter (Jaeger, Tempo, Honeycomb, Datadog)  |
| **Metrics**  | _Phase 14.2 — not yet shipped._ Planned: automatic Prometheus histograms per declared endpoint with correct status-code buckets     | Prometheus / Grafana / Datadog                                    |
| **Logs**     | _Phase 14.3 — not yet shipped._ Planned: structured logging helpers keyed by `traceId` / `endpoint.name`                          | pino / winston + shipper                                          |

Until Phases 14.2 and 14.3 ship, you still get:

- **Metrics** — by using the adapter's standard metrics plugin directly
  (e.g. `fastify-metrics`, `express-prom-bundle`). No Triad-specific
  integration yet.
- **Logs** — by pairing your adapter's standard logger (Fastify has a
  built-in pino logger, Express uses morgan or pino-http) with the
  OpenTelemetry context propagation, which gives you `traceId` in every
  log line automatically once the SDK is running.

## 3. Getting started with `@triad/otel`

### Install

Install `@triad/otel` plus an OpenTelemetry SDK for your runtime.

```bash
npm install @triad/otel @opentelemetry/api @opentelemetry/sdk-node \
            @opentelemetry/auto-instrumentations-node
```

- `@opentelemetry/api` is a peer dependency of `@triad/otel`. It must
  be present, it must be the same version everywhere in your project
  (use a single `npm install` to avoid duplicate-module hazards), and
  it must be resolvable from both your application code and any
  library that produces spans.
- `@opentelemetry/sdk-node` provides the actual implementation of the
  tracer, span processors, batching, and exporters.
- `@opentelemetry/auto-instrumentations-node` is optional but highly
  recommended: it auto-instruments Node.js built-ins (`http`,
  `https`), common database drivers, `undici`, and many other things.
  This is what gives you spans for _outgoing_ HTTP calls and database
  queries — `@triad/otel` only covers what the router knows about.

### Minimal setup

Create `src/tracing.ts`. This file **must be imported before any other
module** that will be instrumented — that's why it lives at the very
top of `src/server.ts`.

```ts
// src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  serviceName: 'my-api',
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

Then import it at the very top of your entry point and wrap the router:

```ts
// src/server.ts
import './tracing.js'; // MUST be first

import Fastify from 'fastify';
import { createRouter } from '@triad/core';
import { triadPlugin } from '@triad/fastify';
import { withOtelInstrumentation } from '@triad/otel';
import { createPet, getPet, listPets } from './pets/endpoints.js';

const router = createRouter({ title: 'My API', version: '1.0.0' });
router.add(createPet, getPet, listPets);

withOtelInstrumentation(router, {
  tracerName: 'my-api',
  staticAttributes: {
    env: process.env.NODE_ENV ?? 'development',
    service: 'my-api',
  },
  includeUserFromState: (state) =>
    (state as { user?: { id: string } }).user?.id,
});

const app = Fastify({ logger: true });
await app.register(triadPlugin, { router, services: { /* ... */ } });
await app.listen({ port: 3000 });
```

### Verify

Run the server with debug logging and hit an endpoint:

```bash
OTEL_LOG_LEVEL=debug node --import tsx src/server.ts
curl http://localhost:3000/pets/abc
```

You should see a span dumped to stdout by `ConsoleSpanExporter` with
`name: 'GET /pets/:id'`, `triad.endpoint.name: 'getPet'`, and an
`http.status_code` attribute. If you don't, jump to §7 (Debugging
missing spans).

### Common mistake

**Forgetting to import `tracing.ts` before `@triad/fastify`.** The
auto-instrumentation hooks into Node's `http` module the moment
`NodeSDK.start()` runs, and it only hooks the copy of `http` that has
not yet been loaded. If Fastify has already required `http` before your
tracing setup runs, the auto-instrumentation silently no-ops and you
see no spans for incoming HTTP requests. The fix: `import './tracing.js'`
on the very first line of your entry file, before every other import.

## 4. What spans get created

`@triad/otel` wraps handlers at four points in the request lifecycle.

### Span name reference

| When                         | Span name                        | SpanKind |
| ---------------------------- | -------------------------------- | -------- |
| HTTP endpoint handler        | `<METHOD> <path>` e.g. `GET /pets/:id` | SERVER   |
| HTTP beforeHandler hook      | `<endpoint.name>.beforeHandler`  | INTERNAL |
| WebSocket channel onConnect  | `<channelName>.onConnect`        | SERVER   |
| WebSocket channel message    | `<channelName>.<messageType>`    | SERVER   |

`SpanKind.SERVER` tells your APM that the span represents the server
handling an incoming request — this is what makes it show up as a
top-level transaction in Honeycomb, Datadog APM, Sentry Performance,
etc. `SpanKind.INTERNAL` is reserved for sub-operations inside a
request, which is the right fit for `beforeHandler` (it's a
sub-operation of the SERVER span the auto-instrumentation or the
handler span will also produce).

### Attribute reference

Every endpoint span gets:

- `http.method` — the declared HTTP method (`GET`, `POST`, etc.)
- `http.route` — the **pattern**, not the resolved path. A request to
  `/pets/abc123` gets `http.route = '/pets/:id'` so your APM can
  aggregate all requests for that endpoint under one bucket. This is
  the single biggest win of framework-level instrumentation.
- `http.status_code` — the status from the handler's returned
  `HandlerResponse`
- `triad.endpoint.name` — the declared endpoint name (the one you pass
  as `name:` in `endpoint({ name: '...' })`)
- `triad.context` — the bounded context name if the endpoint was
  declared inside `router.context(...)`, empty string otherwise
- `enduser.id` — only when `includeUserFromState` is configured and
  returns a string
- Plus any keys you pass as `staticAttributes`

Channel spans additionally get:

- `triad.channel.name` — the channel's declared name
- `triad.channel.message.type` — the message key (only on message
  handlers, not `onConnect`)
- `triad.channel.direction` — `'client'` for client-sent messages

### How spans nest

When `@opentelemetry/auto-instrumentations-node` is running, a real
HTTP request produces a span tree like:

```
http.request (auto-instrumented, SpanKind.SERVER)
└── GET /pets/:id (Triad, SpanKind.SERVER)
    ├── getPet.beforeHandler (Triad, SpanKind.INTERNAL)
    └── <your handler's child spans: db queries, outgoing HTTP, ...>
```

The outer `http.request` span is created by the auto-instrumentation
before your handler runs. `@triad/otel` wraps each handler in its own
`startActiveSpan` call, which sets that new span as the current active
span — so anything your handler does that creates a child span
(database queries, outgoing `fetch` calls, your own manual spans) is
nested inside the `GET /pets/:id` span automatically via OpenTelemetry
context propagation. No manual parenting required.

## 5. Integration cookbook — specific backends

Each vendor has its own preferred packaging. Below are the current
entry points; check each vendor's docs for current versions and config
options — observability packaging moves fast.

### Honeycomb

Honeycomb publishes a wrapper SDK that preconfigures the OTLP exporter
and auth:

```bash
npm install @honeycombio/opentelemetry-node
```

```ts
// src/tracing.ts
import { HoneycombSDK } from '@honeycombio/opentelemetry-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new HoneycombSDK({
  serviceName: 'my-api',
  apiKey: process.env.HONEYCOMB_API_KEY,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Honeycomb is particularly good for high-cardinality attributes — the
`triad.endpoint.name`, `triad.context`, and `enduser.id` tags
`@triad/otel` produces will give you powerful breakdowns out of the
box.

### Datadog

Datadog's own `dd-trace-js` tracer natively understands the
OpenTelemetry API, so you can pair them:

```bash
npm install dd-trace
```

```ts
// src/tracing.ts — loaded first
import tracer from 'dd-trace';
tracer.init({
  service: 'my-api',
  env: process.env.NODE_ENV,
  logInjection: true,
});
```

With `logInjection: true` Datadog auto-attaches `dd.trace_id` to every
log line, which is the fastest way to jump from a log message to its
trace. `@triad/otel` still contributes spans through the OTel API,
which `dd-trace` picks up and ships to Datadog APM.

### Grafana Tempo

Use the OTLP/HTTP exporter to ship spans to an OTel Collector that
forwards to Tempo:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'my-api',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

Pairs well with the Grafana stack: Tempo for traces, Loki for logs,
Prometheus for metrics. All three can use the trace id as a join key
in Grafana's Explore view.

### Jaeger (local development)

Jaeger is the easiest way to see traces locally without setting up a
full stack. Run the all-in-one Docker image and point the OTLP exporter
at it:

```bash
docker run --rm -it \
  -p 16686:16686 -p 4318:4318 -p 4317:4317 \
  jaegertracing/all-in-one:latest
```

Then use the OTLP/HTTP exporter above with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces`.
Open `http://localhost:16686` to see traces.

### Sentry performance monitoring

Sentry can receive OpenTelemetry spans via its SDK's OTel integration:

```bash
npm install @sentry/node @sentry/opentelemetry
```

```ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  integrations: [Sentry.httpIntegration({ tracing: true })],
});
```

The Sentry Node SDK now uses OpenTelemetry internally, so any spans
produced by `@triad/otel` are picked up automatically and surfaced as
transactions in Sentry's Performance UI.

### AWS X-Ray

Use the AWS Distro for OpenTelemetry (ADOT) which ships a preconfigured
X-Ray exporter and ID generator:

```bash
npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation
```

```ts
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: 'my-api',
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new AwsInstrumentation()],
});
sdk.start();
```

Pair with the ADOT Lambda layer when running on AWS Lambda — ADOT
handles sampling and batching correctly across cold starts.

## 6. Common patterns

### Tagging spans with a user id

You already saw this in §3's minimal setup:

```ts
withOtelInstrumentation(router, {
  includeUserFromState: (state) =>
    (state as { user?: { id: string } }).user?.id,
});
```

For this to produce a value, the endpoint's `beforeHandler` must have
attached `user` to `ctx.state`. A typical auth `beforeHandler`:

```ts
beforeHandler: async (ctx) => {
  const token = ctx.rawHeaders.authorization;
  const user = await ctx.services.auth.verify(token);
  if (!user) return { ok: false, response: ctx.respond[401]({ message: 'unauthorized' }) };
  return { ok: true, state: { user } };
},
```

With that in place, every endpoint span gets `enduser.id = <user id>`.

### Correlating spans across service boundaries

This one is free. When you make an outgoing HTTP request inside a
handler and `@opentelemetry/auto-instrumentations-node` is loaded, the
outgoing request gets a `traceparent` header with the current trace
context. The downstream service's own OTel SDK reads that header and
makes its root span a child of yours. You see an end-to-end waterfall
in your trace viewer without writing any correlation code.

If you're making outgoing calls via `fetch` on Node 18+, confirm that
`undici` instrumentation is enabled (it's included in
`getNodeAutoInstrumentations()`). If you're using `axios`, its own
instrumentation ships separately.

### Adding a custom child span for a slow operation

When you have a specific operation inside a handler worth calling out
(a complex SQL query, a call to an ML model, a file upload), wrap it
in your own span. It will automatically nest inside the handler span
that `@triad/otel` created.

```ts
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('my-api');

handler: async (ctx) => {
  const result = await tracer.startActiveSpan('db.findPets', async (span) => {
    try {
      return await ctx.services.petRepo.findByOwner(ctx.params.ownerId);
    } finally {
      span.end();
    }
  });
  return ctx.respond[200](result);
},
```

### Conditionally sampling

Sampling is an SDK concern, not a Triad one. Configure it in your
`tracing.ts`:

```ts
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  // ...
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1), // 10% of traces
  }),
});
```

`ParentBasedSampler` respects the sampling decision of an incoming
`traceparent`, which is what you want for services that sit behind a
gateway or receive traffic from other instrumented services.

### Adding static attributes for environment and region

```ts
withOtelInstrumentation(router, {
  staticAttributes: {
    env: process.env.NODE_ENV ?? 'development',
    region: process.env.AWS_REGION ?? 'local',
    version: process.env.GIT_SHA ?? 'unknown',
  },
});
```

These land on every span the wrapper creates. They are NOT added to
spans created by auto-instrumentation or by your own manual spans —
for those, use `SDK.resource` to set them once at the process level:

```ts
import { resourceFromAttributes } from '@opentelemetry/resources';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'my-api',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  }),
});
```

## 7. Debugging missing spans

Checklist, in order of how often each one bites:

1. **The SDK wasn't imported first.** If your `tracing.ts` import is
   not the very first line of your entry file, the auto-instrumentation
   misses any module that was loaded before it. Symptom: the tracing
   console output shows zero spans when you hit an endpoint.

2. **The router wasn't wrapped.** `withOtelInstrumentation` only
   instruments the endpoints and channels that exist on the router at
   the moment you call it. If you call it before `router.add(...)`, it
   wraps an empty router and nothing happens. Always call it AFTER
   every `router.add()` and `router.context()` and BEFORE registering
   the adapter.

3. **Two copies of `@opentelemetry/api`.** If npm ends up with two
   versions of `@opentelemetry/api` in `node_modules` (because one
   transitive dep pinned an old version), the SDK's global tracer
   provider is registered on one copy and `@triad/otel` reads from the
   other. Symptom: the SDK logs "provider registered" but spans from
   your handlers never appear. Fix: run `npm ls @opentelemetry/api` and
   deduplicate.

4. **Silent exporter errors.** If the OTLP exporter can't reach your
   collector, it silently retries and eventually drops spans. Set
   `OTEL_LOG_LEVEL=debug` to see exporter errors on stderr.

5. **No span processor configured.** `NodeSDK` adds a
   `BatchSpanProcessor` by default when you pass `traceExporter`. If
   you construct a `BasicTracerProvider` manually without adding a
   span processor, spans are created but never exported.

6. **Sampler dropped the span.** A `TraceIdRatioBasedSampler(0.01)` at
   1% means 99 out of 100 requests produce zero spans. During local
   debugging, set sampling to `AlwaysOnSampler()`.

7. **Handler short-circuited in `beforeHandler`.** If `beforeHandler`
   short-circuits, the main handler span is still created (the wrapper
   produces spans for both hooks independently), but if you're
   expecting a child span from something inside the main handler it
   won't appear.

## 8. What `@triad/otel` does NOT do

Be explicit about the boundary:

- **Does not auto-instrument outgoing HTTP calls.** Use
  `@opentelemetry/auto-instrumentations-node` or
  `@opentelemetry/instrumentation-http` / `instrumentation-undici`.
- **Does not auto-instrument database queries.** Use the vendor's OTel
  instrumentation: `@opentelemetry/instrumentation-pg`,
  `instrumentation-mysql2`, `instrumentation-mongodb`, etc. Drizzle
  uses whichever driver you configured, so instrument the driver.
- **Does not configure sampling.** That's the SDK's job. Use
  `ParentBasedSampler` + `TraceIdRatioBasedSampler`.
- **Does not export spans.** You need an exporter (OTLP, Jaeger, vendor
  SDK, etc.). The wrapper only produces spans; shipping them is the
  SDK's job.
- **Does not currently produce metrics.** Phase 14.2 will ship
  automatic per-endpoint Prometheus histograms. Until then, use
  `fastify-metrics` / `express-prom-bundle` / your adapter's native
  metrics plugin.
- **Does not replace APM vendors.** It produces standard OpenTelemetry
  spans that any vendor that speaks OTel can ingest. You still need an
  APM backend to store, index, and visualize them.

## 9. FAQ

**Can I use `@triad/otel` without the `withOtelInstrumentation`
wrapper?** Not in v1. The wrapper is the single opt-in point. A future
version may expose a per-endpoint flag (`endpoint({ otel: false, ... })`)
for fine-grained control, but for now it's all-or-nothing at the router
level.

**Does it work with all three HTTP adapters (Fastify, Express, Hono)?**
Yes. That's the point of instrumenting at the router level instead of
inside each adapter — the wrapper mutates `endpoint.handler` and
`endpoint.beforeHandler` directly on the runtime objects that every
adapter invokes. The adapters don't need to know the wrapper exists.

**What about `@triad/lambda`?** It works. Be aware that OpenTelemetry
SDK initialization adds 100–300ms to the cold start. For latency-
sensitive Lambda functions, use a provisioned-concurrency deployment or
consider the AWS Distro for OpenTelemetry Lambda layer, which keeps the
SDK warm outside your function's code package.

**Can I disable instrumentation for a specific endpoint?** Not in v1.
Workaround: call `withOtelInstrumentation` only on a subset of your
router by splitting sensitive endpoints into a separate router. A
future version will expose a per-endpoint opt-out.

**Does it add overhead?** A handful of microseconds per wrapped call
when a span is sampled in, and near-zero when it's sampled out by a
ratio sampler. If you're writing a sub-millisecond hot path where even
that matters, don't wrap it — move that endpoint into a separate
router and leave that router un-wrapped.

**Why mutate the router instead of returning a new one?** Cloning the
router would require `@triad/otel` to understand the internal shape of
the `Router` class. Mutation keeps the wrapper a few dozen lines of
code and makes it adapter-agnostic. The tradeoff is that
`withOtelInstrumentation(router) === router` — the return value is
there for ergonomic chaining, not because it's a new object.

## 10. Metrics and logs (coming soon)

Metrics and logs are planned for Phases 14.2 and 14.3 and are NOT
shipped today. The shape of those phases, from the roadmap:

- **Phase 14.2 — `@triad/metrics`:** automatic histograms per endpoint
  (`triad_request_duration_seconds`) and per channel message type,
  with labels pulled from the same router metadata the tracing wrapper
  uses. Prometheus scrape endpoint hook for each adapter.
- **Phase 14.3 — `@triad/logging`:** structured logging helpers that
  bind the current trace context to every log line. Paired with
  `pino`, this produces logs with `traceId`, `spanId`,
  `triad.endpoint.name`, and `enduser.id` on every line — making logs
  joinable with traces in any modern backend.

Until those ship, wire up your adapter's standard plugins directly:

- **Fastify:** `fastify-metrics` (Prometheus) and the built-in pino logger
- **Express:** `express-prom-bundle` and `pino-http`
- **Hono:** no first-class Prometheus plugin yet; use a custom
  middleware or gate it behind your own OTel metrics SDK setup

When Phases 14.2 and 14.3 ship, expect drop-in replacements that know
about Triad's router metadata and eliminate the per-adapter wiring.
See `ROADMAP.md` for the current status.
