# @triad/logging

Structured logging instrumentation for Triad routers. Attaches a
request-scoped child logger (endpoint name, bounded context, user id,
request id, static fields) to every log line emitted inside a handler.

This is the third opt-in observability package, alongside
[`@triad/otel`](../otel) for traces and [`@triad/metrics`](../metrics)
for metrics. All three use the same pattern: wrap the router once,
forget about instrumentation inside your handlers.

## Install

```bash
npm install @triad/logging
```

Zero runtime dependencies. Peer-depends on `@triad/core`.

## Quick start

```ts
import pino from 'pino';
import { createRouter } from '@triad/core';
import {
  withLoggingInstrumentation,
  createPinoLogger,
  getLogger,
  requestIdFromHeader,
} from '@triad/logging';

const router = createRouter({ title: 'Books API', version: '1.0.0' });
router.add(/* ...endpoints... */);

const instrumented = withLoggingInstrumentation(router, {
  logger: createPinoLogger(pino()),
  autoLog: true,
  requestId: requestIdFromHeader('x-request-id'),
  includeUserFromState: (state) =>
    (state as { user?: { id: string } }).user?.id,
  staticFields: { service: 'books-api', env: process.env['NODE_ENV'] ?? 'dev' },
});

// Pass `instrumented` to your Fastify/Express/Hono/Lambda adapter.
```

Then inside any handler (or any function it calls, at any await depth):

```ts
import { getLogger } from '@triad/logging';

export const createBook = endpoint({
  // ...
  handler: async (ctx) => {
    const log = getLogger();
    log.info('book.create.start', { title: ctx.body.title });
    const book = await ctx.services.bookRepo.create(ctx.body);
    log.info('book.created', { bookId: book.id });
    return ctx.respond[201](book);
  },
});
```

Every line from that handler automatically includes:

- `triad.endpoint.name` — e.g. `createBook`
- `triad.endpoint.method` — `POST`
- `triad.endpoint.path` — `/books`
- `triad.context` — the bounded context name, or `""` at router root
- `request.id` — whatever your `requestId` extractor returns
- `user.id` — whatever `includeUserFromState` returns
- Any `staticFields` you configured

## Logger adapters

### `createConsoleLogger(options?)`

A zero-dependency JSON-per-line logger. Perfect for dev, Lambda, or
anywhere pino/winston are overkill.

```ts
import { createConsoleLogger } from '@triad/logging';

const logger = createConsoleLogger({ level: 'info', pretty: false });
// { "level":"info","message":"book.created","time":"2026-04-10T...","bookId":"42" }

// Human-readable output for local dev:
const pretty = createConsoleLogger({ pretty: true });
// 2026-04-10T... INFO book.created bookId=42
```

### `createPinoLogger(pinoInstance)`

Wraps a user-supplied pino logger. You own the pino config — transports,
levels, redaction, serializers.

```ts
import pino from 'pino';
import { createPinoLogger } from '@triad/logging';

const logger = createPinoLogger(
  pino({ level: 'info', redact: ['password', 'token'] }),
);
```

Pino's `logger.info(obj, msg)` arg order is preserved internally. The
wrapper calls `pinoInstance.child(bindings)` for per-request context.

### `createWinstonLogger(winstonInstance)`

Wraps a user-supplied winston logger.

```ts
import winston from 'winston';
import { createWinstonLogger } from '@triad/logging';

const logger = createWinstonLogger(
  winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
  }),
);
```

Winston's `logger.info(msg, meta)` arg order is preserved internally.

### Bring your own logger

Implement the `Logger` interface and pass it in. It's four methods plus
`child()`:

```ts
import type { Logger } from '@triad/logging';

const myLogger: Logger = {
  debug(msg, ctx) { /* ... */ },
  info(msg, ctx) { /* ... */ },
  warn(msg, ctx) { /* ... */ },
  error(msg, ctx) { /* ... */ },
  child(ctx) { /* return a Logger with ctx merged into every call */ },
};

withLoggingInstrumentation(router, { logger: myLogger });
```

## How `getLogger()` works

`@triad/logging` uses Node's built-in `AsyncLocalStorage` to bind the
request-scoped child logger to the current async context. When the
wrapper runs your handler, it does so inside `als.run(childLogger, ...)`
— and because `AsyncLocalStorage` propagates across `await` boundaries,
`getLogger()` returns the correct logger no matter how deep the call
stack or how many `await`s have gone by.

```ts
// All three of these log with the same request-scoped context:
async function handler(ctx) {
  getLogger().info('start');
  await doWork();  // doWork() calls getLogger() internally
  getLogger().info('end');
}
```

- `getLogger()` — throws if called outside a wrapped handler.
- `tryGetLogger()` — returns `undefined` outside a wrapped handler.

## `autoLog: true`

When enabled, the wrapper automatically emits a start and end line per
request, and an error line if the handler throws:

```json
{"level":"info","message":"handler.start","triad.endpoint.name":"createBook", ...}
{"level":"info","message":"handler.end","http.status_code":201, ...}
```

On failure:

```json
{"level":"error","message":"handler.error","error":"Book title too long", ...}
```

## Channel instrumentation

WebSocket channel handlers and `onConnect` are wrapped by default
(disable with `instrumentChannels: false`). Inside a channel handler,
`getLogger()` returns a child logger with:

- `triad.channel.name`
- `triad.channel.message.type` (or `"onConnect"`)
- `triad.context`
- `request.id`, `user.id`, `staticFields` (same as endpoints)

## What this package does not do

- **No transports.** The logger you bring owns transports, formatting,
  redaction, rotation, shipping. This package just attaches context.
- **No sampling.** Configure that in your underlying logger.
- **No aggregation.** Use your log pipeline (Datadog, Loki, CloudWatch,
  whatever).
- **No metrics or traces.** Those are `@triad/metrics` and `@triad/otel`.

## Related

- [Observability guide](../../docs/guides/observability.md)
- [`@triad/otel`](../otel) — traces
- [`@triad/metrics`](../metrics) — metrics
