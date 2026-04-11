# @triad/lambda

AWS Lambda adapter for [Triad](https://github.com/) routers. Turns a
Triad router into a Lambda handler suitable for API Gateway v1 (REST
API), API Gateway v2 (HTTP API), Lambda Function URLs, and ALB targets.

```ts
import { createLambdaHandler } from '@triad/lambda';
import router from './app.js';
import { createServices } from './services.js';

export const handler = createLambdaHandler(router, {
  services: (event) =>
    createServices({
      tenant: event.headers?.['x-tenant'] ?? 'default',
    }),
});
```

## Features

- Detects API Gateway v1/v2 and ALB events automatically
- Coerces query/path/header strings to their schema types
- Validates requests and emits the same error envelopes as
  `@triad/express`, `@triad/fastify`, and `@triad/hono`
- Zero runtime dependencies — every byte matters for cold starts
- Supports `basePath` stripping for stage-mounted deployments
- Per-request services factory receives the raw Lambda event

## Non-goals

- WebSocket channels — Lambda is request/response only. Use
  `@triad/fastify` on a long-lived container if you need channels.
- Streaming responses — v1 emits buffered JSON only.

## See also

- [Deploying to AWS cookbook](../../docs/guides/deploying-to-aws.md)
- [Choosing an adapter](../../docs/guides/choosing-an-adapter.md)
