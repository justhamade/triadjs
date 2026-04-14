# Step 1 — Hello, Bookshelf

**Goal:** write ~30 lines, see `triad test` pass, see `triad docs` emit OpenAPI, and serve one HTTP endpoint with Fastify. Target: 5 minutes.

You will build the bones of Bookshelf — a personal book-collection API — with one endpoint that greets you. In [step 2](02-crud-api.md) you will replace this with a real `Book` resource. Right now the goal is to wire Triad up end-to-end.

## 1. Install

Create a fresh directory and initialize it:

```bash
mkdir bookshelf && cd bookshelf
npm init -y
npm pkg set type=module
npm install @triadjs/core @triadjs/fastify fastify
npm install -D @triadjs/cli @triadjs/test-runner tsx typescript @types/node
```

Triad requires **Node 20+** — `node --version` should print `v20.` or newer. The `type: "module"` setting is not optional; Triad is an ESM-only framework and the CLI loads your config via native `import()`.

Create a minimal `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  },
  "include": ["src", "triad.config.ts"]
}
```

Strict mode is not a style choice — `ctx.body`, `ctx.params`, and `ctx.respond[...]` are all inferred, and without strict mode you lose the types that make Triad worth using.

## 2. Write the app

Create `src/app.ts`:

```ts
import { createRouter, endpoint, scenario, t } from '@triadjs/core';

const HelloResponse = t.model('HelloResponse', {
  message: t.string().doc('Greeting text'),
});

const hello = endpoint({
  name: 'hello',
  method: 'GET',
  path: '/hello',
  summary: 'Greet the reader',
  tags: ['Greeting'],
  responses: {
    200: { schema: HelloResponse, description: 'The greeting' },
  },
  handler: async (ctx) => {
    return ctx.respond[200]({ message: 'Hello, world!' });
  },
  behaviors: [
    scenario('The greeting endpoint returns a hello message')
      .given('no setup required')
      .when('I GET /hello')
      .then('response status is 200')
      .and('response body matches HelloResponse')
      .and('response body has message "Hello, world!"'),
  ],
});

const router = createRouter({
  title: 'Bookshelf API',
  version: '0.1.0',
  description: 'A personal book-collection API',
});

router.add(hello);

export default router;
```

That is the entire application. Two things are worth pausing on:

> **Why a model for one field?** You could inline `{ message: t.string() }` in the response. But giving the shape a name means OpenAPI emits a reusable `HelloResponse` component, and the scenario can assert `response body matches HelloResponse`. The tutorial keeps this habit throughout.

> **Why `scenario(...)` instead of a separate test file?** In Triad, the scenario IS the test. Running `triad test` parses the behaviors array and runs each scenario through the handler in-process. No HTTP, no mocking, no import duplication.

## 3. Configure the CLI

Create `triad.config.ts` at the project root:

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  router: './src/app.ts',
  docs: {
    output: './generated/openapi.yaml',
  },
});
```

No `test.setup` yet — this step has no database, so there are no services to initialize per scenario.

## 4. Run the tests

```bash
npx triad test
```

You should see one passing scenario. If you broke the assertion string (say, single-quoted `'Hello, world!'`), the runner will tell you exactly which line failed. Assertion parsing is strict on purpose — see [step 3](03-testing.md).

## 5. Generate OpenAPI

```bash
npx triad docs
```

This writes `./generated/openapi.yaml`. Open it — the relevant slice looks like this:

```yaml
openapi: 3.1.0
info:
  title: Bookshelf API
  version: 0.1.0
paths:
  /hello:
    get:
      operationId: hello
      summary: Greet the reader
      tags: [Greeting]
      responses:
        '200':
          description: The greeting
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HelloResponse'
components:
  schemas:
    HelloResponse:
      type: object
      required: [message]
      properties:
        message:
          type: string
          description: Greeting text
```

Every character of that file came from the `endpoint()` call. You will never hand-edit it.

## 6. Serve it over HTTP

Create `src/server.ts`:

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';

const app = Fastify({ logger: true });

await app.register(triadPlugin, { router, services: {} });

await app.listen({ port: 3000, host: '0.0.0.0' });
```

Add a `start` script to `package.json`:

```json
{
  "scripts": {
    "start": "tsx src/server.ts",
    "test": "triad test",
    "docs": "triad docs"
  }
}
```

Run it:

```bash
npm start
```

In another terminal:

```bash
curl http://localhost:3000/hello
# {"message":"Hello, world!"}
```

Stop the server with `Ctrl+C`.

## What just happened

One schema (`HelloResponse`) produced:

1. **A TypeScript type** — `ctx.respond[200](...)` requires an object matching the model, at compile time.
2. **Runtime validation** — both the outgoing response and the behavior scenario's assertions are validated against the same schema.
3. **An OpenAPI component** — `$ref: '#/components/schemas/HelloResponse'` in the generated file.
4. **An executable test** — the `response body matches HelloResponse` assertion re-validates the handler output.

One router binding (`router.add(hello)`) produced:

1. **A Fastify route** — registered automatically by `triadPlugin`.
2. **A test target** — `triad test` finds the endpoint, loads its behaviors, and runs them in-process.
3. **An OpenAPI path** — `/hello` with the correct method and response.

This is the shape of every Triad feature you will add for the rest of the tutorial: declare once, get docs + tests + routes for free.

## Next up

[Step 2 — CRUD API](02-crud-api.md). You will throw away `HelloResponse`, define a real `Book` entity, and build five CRUD endpoints against an in-memory repository. This is where Triad starts looking like a web framework.
