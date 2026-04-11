# Triad Guides

Topical how-tos for picking adapters, ORMs, and working productively with AI coding assistants. These are reference-style guides you dip into when you need to make a specific decision — not a tutorial. If you are new to Triad, start with the [tutorial](../tutorial/) and then come back here when you are ready to make framework-level choices.

## Guides

- [**Choosing an adapter**](./choosing-an-adapter.md) — how to pick Fastify, Express, or Hono, what each one costs you, and how to migrate between them without breaking clients.
- [**Choosing an ORM**](./choosing-an-orm.md) — how the Drizzle bridge works, when to skip it, and how to wire Prisma, Kysely, or raw SQL into a Triad project.
- [**Working with AI assistants**](./working-with-ai.md) — practical setup and prompts for Claude Code, Cursor, Copilot, and Aider, plus a catalogue of common agent mistakes and how to catch them.
- [**Triad on Supabase**](./supabase.md) — deploying a Triad API as a Supabase Edge Function on Deno, with Supabase Auth, per-request Supabase clients, RLS as defense in depth, and the memory-vs-Supabase repository split.

## When to read what

| I want to... | Read |
|---|---|
| Build my first Triad app step by step | [`docs/tutorial/`](../tutorial/) |
| Look up a specific API name or pattern | [`docs/ai-agent-guide.md`](../ai-agent-guide.md) |
| Pick an HTTP framework | [Choosing an adapter](./choosing-an-adapter.md) |
| Decide whether to use Drizzle or something else | [Choosing an ORM](./choosing-an-orm.md) |
| Brief an AI agent so it writes idiomatic Triad code | [Working with AI](./working-with-ai.md) |
| Understand DDD patterns (aggregates, repositories, bounded contexts) | [`docs/ddd-patterns.md`](../ddd-patterns.md) |
| See the full schema DSL reference | [`docs/schema-dsl.md`](../schema-dsl.md) |
| Wire Triad schemas to a Drizzle-backed database | [`docs/drizzle-integration.md`](../drizzle-integration.md) |
| Use WebSocket channels | [`docs/phase-9-websockets.md`](../phase-9-websockets.md) |

The [AI agent guide](../ai-agent-guide.md) is the canonical API reference. Every guide here links back to it rather than re-deriving details.
