# @triadjs/asyncapi

Generate [AsyncAPI 3.0](https://www.asyncapi.com/) documents from Triad channel definitions. The real-time counterpart to `@triadjs/openapi` — channels, messages, and payload schemas are turned into a spec-compliant AsyncAPI document that tooling can consume directly.

## Install

```bash
npm install @triadjs/asyncapi
```

## Quick Start

```ts
import { createRouter, channel, t } from '@triadjs/core';
import { generateAsyncAPI, toYaml } from '@triadjs/asyncapi';

const ChatMessage = t.object({ text: t.string() }).meta({ name: 'ChatMessage' });

const chatRoom = channel('/chat/:roomId', {
  clientMessages: {
    sendMessage: { schema: ChatMessage, description: 'User sends a chat message' },
  },
  serverMessages: {
    newMessage: { schema: ChatMessage, description: 'Broadcast to all clients' },
  },
});

const router = createRouter({ title: 'Chat API', version: '1.0.0' });
router.add(chatRoom);

const doc = generateAsyncAPI(router);
console.log(toYaml(doc));
```

## Features

- **AsyncAPI 3.0 output** — produces a fully valid document with `channels`, `operations`, and `components`.
- **Direction-namespaced operations** — client messages become `receive` operations and server messages become `send` operations (from the server's perspective), with operation IDs namespaced by `channel.direction.messageType`.
- **Shared schemas with OpenAPI** — payload models use the same `toOpenAPI()` machinery as `@triadjs/openapi`, so a schema declared once appears identically in both documents under `components/schemas`.
- **WebSocket bindings** — headers and query schemas declared on `channel.connection` are emitted as `channel.bindings.ws` objects.
- **Bounded context tagging** — channels inside a bounded context are auto-tagged with the context name, and contexts with channels produce top-level `tags[]` entries.
- **Path parameter conversion** — Fastify-style `:id` params are converted to AsyncAPI `{id}` syntax.
- **YAML and JSON serialization** — `toYaml(doc)` and `toJson(doc)` handle output formatting.

## API

| Export | Description |
| --- | --- |
| `generateAsyncAPI(router, options?)` | Walk a router and return an `AsyncAPIDocument` object |
| `toYaml(doc)` | Serialize to YAML string |
| `toJson(doc, indent?)` | Serialize to JSON string |
| `convertPath(path)` | Convert `:param` to `{param}` notation |

## CLI

When your router defines channels, the Triad CLI generates both specs in one pass:

```bash
triad docs
# → openapi.yaml + asyncapi.yaml
```

## Links

- [Triad documentation](https://github.com/justinhamade/triad)
- [AsyncAPI 3.0 specification](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
