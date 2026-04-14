# @triadjs/express

Express adapter for the [Triad](https://github.com/) framework. Mounts a
Triad router onto an `express` application, validating requests against
declared schemas and dispatching handler responses.

## Installation

```bash
npm install @triadjs/express express
```

## Usage

```ts
import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triadjs/express';
import router from './src/app.js';

const app = express();

// IMPORTANT: express.json() (or any body parser you use) must be
// registered BEFORE the Triad router. The adapter reads req.body after
// it has been parsed.
app.use(express.json());

app.use(createTriadRouter(router, {
  services: { petRepo, adoptionSaga },
}));

// Optional: register the error handler to format stray Triad errors
// (e.g. a RequestValidationError thrown from your own middleware) with
// the same JSON envelope as @triadjs/fastify.
app.use(triadErrorHandler());

app.listen(3000);
```

### Per-request services

```ts
app.use(createTriadRouter(router, {
  services: (req) => ({
    petRepo: petRepoFor(req.header('x-tenant') ?? 'default'),
    currentUser: req.user,
  }),
}));
```

### Mount prefix

Mount the Triad router under a sub-path using express's normal API:

```ts
app.use('/api/v1', createTriadRouter(router, { services }));
```

## Error envelope

Request validation failures and response-validation safety-net errors
produce the same JSON envelope shape as `@triadjs/fastify`, so clients
can be swapped between adapters without noticing:

```json
// 400 — request validation error
{
  "code": "VALIDATION_ERROR",
  "message": "Request body failed validation: name: Expected string, got undefined",
  "errors": [ { "path": "name", "message": "Expected string, got undefined" } ]
}
```

```json
// 500 — handler returned a body that did not match its declared schema
{
  "code": "INTERNAL_ERROR",
  "message": "The server produced an invalid response."
}
```

## Limitations

- **No WebSocket / channel support in v1.** Triad channels only work
  through `@triadjs/fastify` at the moment. Express channel support is on
  the backlog — until then, use the fastify adapter if your router
  declares channels.
- **No OpenAPI serving.** Neither adapter serves OpenAPI documents at
  runtime. Generate them at build time with the Triad CLI.

## File uploads

Endpoints whose request body contains at least one `t.file()` field are
automatically routed through [`multer`](https://www.npmjs.com/package/multer)
(memory storage). Install it as a peer dependency:

```bash
npm install multer
```

Declare file fields on the body schema and the adapter will normalize them
into `TriadFile` instances before handing the body to your handler:

```ts
import { t, endpoint, type TriadFile } from '@triadjs/core';

const AvatarUpload = t.model('AvatarUpload', {
  name: t.string(),
  avatar: t.file().maxSize(5_000_000).mimeTypes('image/png', 'image/jpeg'),
});

export const uploadAvatar = endpoint({
  name: 'uploadAvatar',
  method: 'POST',
  path: '/avatars',
  summary: 'Upload an avatar',
  request: { body: AvatarUpload },
  responses: {
    201: { schema: t.model('Ok', { url: t.string() }), description: 'Uploaded' },
  },
  handler: async (ctx) => {
    const file: TriadFile = ctx.body.avatar;
    return ctx.respond[201]({ url: `/u/${file.name}` });
  },
});
```

Schema-level `maxSize` / `mimeTypes` / `minSize` violations produce the
standard `VALIDATION_ERROR` envelope with error codes `file_too_large`,
`invalid_mime_type`, etc. Sending `application/json` to a file-bearing
endpoint returns 400 with `code: 'expected_multipart'`.

## Express-specific quirks

- You must register a JSON body parser (`express.json()`) before the
  Triad router. The fastify adapter parses JSON internally — express
  does not.
- Unknown errors thrown from handlers propagate via `next(err)`. The
  optional `triadErrorHandler()` middleware only formats known Triad
  error types; non-Triad errors fall through to express's default
  error handler (or any handler you register after it).
