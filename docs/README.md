# Triad Documentation

Everything you need to build and ship an API with Triad. This directory is organized by **what you're trying to do**, not by what part of the framework a topic lives in.

## Start here

New to Triad? Work through the tutorial in order. It builds one app — **Bookshelf** — from a hello-world endpoint to a production-ready deployment, adding one capability per step.

| Step | Topic | What you'll have at the end |
|---|---|---|
| [1](tutorial/01-hello-world.md) | Hello world | One endpoint, one scenario, generated OpenAPI, Fastify server running |
| [2](tutorial/02-crud-api.md) | CRUD API | Full book CRUD, in-memory repository, bounded context, 6 scenarios |
| [3](tutorial/03-testing.md) | Testing deep dive | Fixtures, placeholder substitution, the complete assertion phrase reference |
| [4](tutorial/04-persistence.md) | Real persistence | Drizzle + SQLite, per-scenario DB isolation, `triad db generate`, `triad db migrate` |
| [5](tutorial/05-authentication.md) | Authentication | User accounts, `requireAuth` beforeHandler, `checkOwnership` for 403/404 branching |
| [6](tutorial/06-websockets.md) | WebSockets | Real-time review channel, AsyncAPI output, channel behaviors |
| [7](tutorial/07-production.md) | Production-ready | Config, structured logging, Docker, CI, deploy on Fastify / Express / Hono |

Already know the basics? Jump to whichever step matches what you're building.

## Topical guides

Not a linear tutorial — pick the guide that matches the decision you're making right now.

- **[Choosing an adapter](guides/choosing-an-adapter.md)** — Fastify vs Express vs Hono, with a decision matrix, side-by-side server setups, migration paths, and the trade-off each adapter makes. If you need WebSockets, pick Fastify. If you need edge runtime, pick Hono. If you need the Express middleware ecosystem, pick Express.
- **[Choosing an ORM](guides/choosing-an-orm.md)** — Triad ships the Drizzle bridge as the default happy path, but Triad's core is ORM-agnostic. This guide shows Drizzle (with and without the bridge), Prisma, Kysely, and raw SQL. You keep everything except codegen when you go off the happy path.
- **[Working with AI coding assistants](guides/working-with-ai.md)** — How to point Claude Code, Cursor, Copilot, and Aider at the [AI Agent Guide](ai-agent-guide.md), including a library of ready-to-paste prompts for common Triad tasks ("add an endpoint", "convert REST to a channel", "add pagination"), a list of common agent failure modes with how to catch them, and when to NOT use an agent.
- **[Triad on Supabase](guides/supabase.md)** — Deploying a Triad API as a Supabase Edge Function on Deno: service injection via Supabase client, Supabase Auth + `requireAuth` beforeHandler, RLS as defense in depth, Realtime as a channel broadcast backend, Storage, Cron, and deployment walkthrough.
- **[Deploying to AWS](guides/deploying-to-aws.md)** — Every AWS deployment path covered: `@triad/lambda` with API Gateway / Function URL / ALB, ECS Fargate, App Runner, Elastic Beanstalk, and raw EC2. Decision matrix, SAM + CDK snippets, CI/CD patterns, cold-start tuning, and honest cost math for 100k / 10M / 100M req/month.
- **[Observability](guides/observability.md)** — OpenTelemetry integration via `@triad/otel` (opt-in router wrapper). Six backend integrations (Honeycomb, Datadog, Grafana Tempo, Jaeger, Sentry, AWS X-Ray), the full span + attribute reference, common patterns, and a debugging checklist.
- **[Authentication](guides/auth.md)** — `@triad/jwt` wrapping `jose` as a typed `requireJWT` BeforeHandler factory, plus integration cookbooks for Auth0, Clerk, WorkOS, Firebase Auth, NextAuth, Supabase Auth, session cookies for SSR apps, API keys for server-to-server, multi-tenancy, and RBAC layered on `beforeHandler`.
- **[Security](guides/security.md)** — `@triad/security-headers` middleware for Fastify/Express/Hono with opinionated CSP/HSTS/frame/permissions defaults and CSP nonce support. Cookbook covers threat modeling, rate limiting per adapter, CORS, CSRF, input sanitization, secrets management, dependency scanning, OWASP Top 10 coverage audit, and a pre-production checklist.

## Reference

Deep reference material for specific subsystems.

- **[AI Agent Guide](ai-agent-guide.md)** — The canonical source-grounded reference. ~1400 lines covering the schema DSL, endpoints, channels, behaviors, services, CLI, adapters, Drizzle bridge, DDD patterns, common pitfalls, and an end-to-end cheat sheet. Feed this to any AI coding assistant working in a Triad project.
- **[Schema DSL](schema-dsl.md)** — Every primitive, composition, and constraint the `t` namespace supports.
- **[DDD patterns](ddd-patterns.md)** — Repositories, aggregates, domain services, factories, sagas, bounded contexts, and the ownership + access control pattern.
- **[Drizzle integration](drizzle-integration.md)** — How Triad schemas map to Drizzle tables, when to hand-write vs generate, the `.storage()` metadata, and the per-dialect emitter model.
- **[WebSocket channel design](phase-9-websockets.md)** — The original design spec for channels. Read this for the reasoning behind why channels look the way they do; read the AI Agent Guide §4 for how to use them today.

## Quickstart

If you want a single-page "build a petstore API in 5 minutes" path that shows all the core pieces at once, the legacy [Quickstart](quickstart.md) is still here. The tutorial starting at [step 1](tutorial/01-hello-world.md) covers the same ground more slowly and builds toward a real app.

## What goes where

Use this table when you're not sure which doc to read.

| I want to… | Read |
|---|---|
| Build my first Triad app | [Tutorial step 1](tutorial/01-hello-world.md) |
| Understand the scenario DSL | [Tutorial step 3](tutorial/03-testing.md) or [AI Agent Guide §5](ai-agent-guide.md) |
| Auto-generate boundary/fuzz tests | [AI Agent Guide §5.8](ai-agent-guide.md) — `scenario.auto()` + `triad fuzz` |
| Add auth to an existing app | [Tutorial step 5](tutorial/05-authentication.md) |
| Pick a server framework | [Choosing an adapter](guides/choosing-an-adapter.md) |
| Use a database that isn't Drizzle | [Choosing an ORM](guides/choosing-an-orm.md) |
| Direct an AI coding assistant | [Working with AI](guides/working-with-ai.md) + [AI Agent Guide](ai-agent-guide.md) |
| Look up a schema primitive | [Schema DSL](schema-dsl.md) or [AI Agent Guide §2](ai-agent-guide.md) |
| Model a complex domain | [DDD patterns](ddd-patterns.md) |
| Deploy to production | [Tutorial step 7](tutorial/07-production.md) |
| Understand the framework's goals | [Root README](../README.md) and [ROADMAP](../ROADMAP.md) |

## Reference implementations

Four example apps live under `examples/` in the repo. Read their source for the most honest picture of what idiomatic Triad looks like.

- **[`examples/petstore`](../examples/petstore)** — Fastify + Drizzle + SQLite + WebSocket chat channel. Three bounded contexts, value objects, DDD repositories. 16 behavior scenarios + 21 e2e tests.
- **[`examples/tasktracker`](../examples/tasktracker)** — Express + Drizzle + bearer-token auth + cursor pagination + ownership checks. 27 scenarios + 21 e2e tests.
- **[`examples/bookshelf`](../examples/bookshelf)** — Fastify + Drizzle + auth + channels + pagination. The tutorial's final state — all features in one app. 21 scenarios + 19 e2e tests.
- **[`examples/supabase-edge`](../examples/supabase-edge)** — Hono + Supabase + Deno edge deployment. Supabase Auth, per-request client injection, repository split (memory for tests, Supabase for production). 19 scenarios + 13 e2e tests.

## Contributing to the docs

Found a gap, a stale claim, or an example that doesn't compile? Open an issue or PR. The documentation lives in this directory and the [AI Agent Guide](ai-agent-guide.md) is updated whenever the core API changes — if you see something that contradicts the source, the source wins and the docs need a fix.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow.
