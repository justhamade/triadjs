# Triad Tutorial — Bookshelf API

This tutorial builds a single app — **Bookshelf**, a personal book-collection API — over seven short steps. Each step adds exactly one capability and ends with a runnable project. Skip any step you already know; the code at the end of each step is fully specified, so you can drop in and continue.

By the end you will have a production-ready Triad service with users, authentication, ownership checks, real-time review notifications, and a deployable container. Every feature is grounded in real Triad source — no hand-waved snippets.

## Prerequisites

- **Node 20+** and **TypeScript 5.x**. Triad relies on native `crypto.randomUUID`, top-level `await`, and ESM.
- Comfort with TypeScript basics (generics, `type`, `interface`). You do not need prior Triad experience.
- A terminal, an editor, and about an hour if you do every step in one sitting.

## How to use this tutorial

Create a fresh directory and follow along. The first step produces a complete 30-line project; every subsequent step only tells you what to add or change. If you get stuck, the file paths in each step map 1:1 to the reference examples under `examples/petstore/` and `examples/tasktracker/` in the Triad repository.

If you are using an AI assistant (Claude Code, Cursor, Copilot, Aider, etc.), point it at [`docs/ai-agent-guide.md`](../ai-agent-guide.md) first. That document is the canonical API reference; this tutorial is the narrative companion.

## The steps

| Step | File | What you add |
|---|---|---|
| 1 | [01-hello-world.md](01-hello-world.md) | One endpoint, one scenario, one generated OpenAPI file, a Fastify server. |
| 2 | [02-crud-api.md](02-crud-api.md) | A `Book` model, five CRUD endpoints, an in-memory repository, bounded contexts. |
| 3 | [03-testing.md](03-testing.md) | Behavior deep dive — `.setup()`, fixtures, `{placeholder}` substitution, the assertion phrase table. |
| 4 | [04-persistence.md](04-persistence.md) | Drizzle + better-sqlite3, per-scenario DB isolation, `triad db generate`, `triad db migrate`. |
| 5 | [05-authentication.md](05-authentication.md) | `User` entity, register/login, `requireAuth` beforeHandler, ownership checks via `checkOwnership`. |
| 6 | [06-websockets.md](06-websockets.md) | A `bookReviews` channel, typed connection state, AsyncAPI generation. |
| 7 | [07-production.md](07-production.md) | Config, structured logging, graceful shutdown, Docker, CI, deploy on Fastify / Express / Hono. |

## What's next

Once you finish step 7, Bookshelf is a working, tested, documented, deployable Triad service. From there:

- Read [`docs/guides/`](../guides/) for topical how-tos (pagination, error handling, adapter comparison, working with AI assistants).
- Read [`docs/ai-agent-guide.md`](../ai-agent-guide.md) for the exhaustive API reference — especially section 5 for the complete assertion phrase list and section 10 for the Drizzle bridge.
- Read [`docs/ddd-patterns.md`](../ddd-patterns.md) for the DDD thinking behind the framework — bounded contexts, aggregates, ubiquitous language, ownership.
- Read the reference examples under `examples/petstore/` (Fastify + channels) and `examples/tasktracker/` (Express + auth + pagination). Every pattern you learn here is exercised in one of them.

Ready? Start with [step 1](01-hello-world.md).
