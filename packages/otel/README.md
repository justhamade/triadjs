# @triad/otel

OpenTelemetry instrumentation for Triad routers. Opt-in, router-level,
adapter-agnostic.

## Install

```bash
npm install @triad/otel @opentelemetry/api
```

You also need an OpenTelemetry SDK and exporter of your choice — e.g.
`@opentelemetry/sdk-node` with `@opentelemetry/auto-instrumentations-node`.
See [docs/guides/observability.md](../../docs/guides/observability.md)
for the end-to-end walkthrough.

## Usage

```ts
import { createRouter } from '@triad/core';
import { withOtelInstrumentation } from '@triad/otel';
import { triadPlugin } from '@triad/fastify';

const router = createRouter({ title: 'My API', version: '1.0.0' });
router.add(createPet, getPet, listPets);

withOtelInstrumentation(router, {
  tracerName: 'my-api',
  staticAttributes: { env: 'production' },
  includeUserFromState: (state) =>
    (state as { user?: { id: string } }).user?.id,
});

await app.register(triadPlugin, { router, services });
```

`withOtelInstrumentation` **mutates** the router's endpoints and
channels in place, replacing their handlers with span-creating
versions. It returns the same router instance for convenient chaining.

## Spans produced

| When                         | Span name                        | SpanKind |
| ---------------------------- | -------------------------------- | -------- |
| HTTP endpoint handler        | `<METHOD> <path>`                | SERVER   |
| HTTP beforeHandler hook      | `<endpoint.name>.beforeHandler`  | INTERNAL |
| Channel onConnect            | `<channelName>.onConnect`        | SERVER   |
| Channel client message       | `<channelName>.<messageType>`    | SERVER   |

## Attributes

Every endpoint span is tagged with:

- `http.method`, `http.route`, `http.status_code`
- `triad.endpoint.name`, `triad.context`
- `enduser.id` (when `includeUserFromState` returns a value)
- everything from `staticAttributes`

Channel spans additionally tag `triad.channel.name`,
`triad.channel.message.type`, and `triad.channel.direction`.

## What it does NOT do

- Does not configure an SDK or exporter — bring your own.
- Does not instrument outgoing HTTP or database calls — use
  `@opentelemetry/auto-instrumentations-node` or a driver-specific
  instrumentation package.
- Does not produce metrics yet — Phase 14.2 will add `@triad/metrics`.

See [docs/guides/observability.md](../../docs/guides/observability.md)
for full integration recipes for Honeycomb, Datadog, Grafana Tempo,
Jaeger, Sentry, and AWS X-Ray.
