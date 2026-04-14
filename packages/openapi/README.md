# @triadjs/openapi

Generates OpenAPI 3.1 documents from a Triad router. Named models become `$ref` entries in `components/schemas`, bounded contexts become documented tags, and the output serializes to both YAML and JSON.

## Install

```bash
npm install @triadjs/openapi
```

## Quick Start

```ts
import { t, endpoint, createRouter } from '@triadjs/core';
import { generateOpenAPI, toYaml, toJson } from '@triadjs/openapi';

const Pet = t.model('Pet', {
  id:   t.string().format('uuid'),
  name: t.string(),
});

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  request: { body: Pet.omit('id') },
  responses: {
    201: { schema: Pet, description: 'Created' },
  },
  handler: async (ctx) => ctx.respond[201]({ id: '1', name: 'Buddy' }),
});

const router = createRouter({ title: 'Petstore', version: '1.0.0' });
router.add(createPet);

const doc = generateOpenAPI(router);

console.log(toYaml(doc));
// or
console.log(toJson(doc));
```

The generated document includes the full `paths`, `components/schemas`, `info`, `servers`, and `tags` sections expected by any OpenAPI 3.1 consumer.

## Features

### Named models become `$ref`

Any schema created with `t.model()` is emitted once under `components/schemas` and referenced via `$ref` everywhere it appears. Inline shapes (anonymous objects passed to `request.params`, `request.query`, etc.) are expanded in place.

### Bounded contexts become tags

When endpoints are registered inside a `router.context()`, the context name is added as an OpenAPI tag with its description. Endpoints inside a context are auto-tagged.

```ts
router.context('Adoption', {
  description: 'Manages the pet adoption lifecycle',
  models: [Pet],
}, (ctx) => {
  ctx.add(createPet, getPet);
});
```

Produces:

```yaml
tags:
  - name: Adoption
    description: Manages the pet adoption lifecycle
```

### File uploads

Endpoints with `t.file()` fields in the request body automatically use `multipart/form-data` as the content type.

### Empty responses

Responses declared with `t.empty()` (e.g. 204 No Content) omit the `content` key, matching the HTTP and OpenAPI specification for bodyless responses.

### Path conversion

Express-style `:param` paths are converted to OpenAPI `{param}` format automatically.

### YAML and JSON serialization

```ts
import { toYaml, toJson } from '@triadjs/openapi';

toYaml(doc);          // OpenAPI-compatible YAML string
toJson(doc);          // pretty-printed JSON (default indent: 2)
toJson(doc, 0);       // compact JSON
```

## CLI

The Triad CLI provides a `docs` command that loads your router and generates the OpenAPI document:

```bash
npx triad docs --format yaml
npx triad docs --format json
```

## API Reference

### `generateOpenAPI(router, options?)`

Returns an `OpenAPIDocument` object (OpenAPI 3.1.0).

| Parameter | Type | Description |
|-----------|------|-------------|
| `router` | `Router` | A Triad router with registered endpoints |
| `options.includeUntagged` | `boolean` | Include endpoints with empty tags (default: `true`) |

### `toYaml(doc)`

Serializes an `OpenAPIDocument` to a YAML string.

### `toJson(doc, indent?)`

Serializes an `OpenAPIDocument` to a JSON string. `indent` defaults to `2`.

### `convertPath(path)`

Converts Express-style `:param` path segments to OpenAPI `{param}` format.

## Links

- [@triadjs/core](../core/README.md)
- [Schema DSL Reference](../../docs/schema-dsl.md)
- [AI Agent Guide](../../docs/ai-agent-guide.md)
