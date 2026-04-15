---
name: triad-cli
description: Use when running the `triad` CLI — `triad test`, `triad docs`, `triad gherkin`, `triad db generate`, `triad validate`, `triad fuzz` — configuring `triad.config.ts`, debugging CLI errors, or understanding flag behavior.
---

# CLI — command reference

The `triad` binary (from `@triadjs/cli`) dispatches to subcommands. Configs are discovered by walking upward from the cwd unless `--config` is passed.

## Top-level flags (work on every subcommand)

| Flag | Purpose |
|---|---|
| `-c, --config <path>` | Override `triad.config.ts` path |
| `-r, --router <path>` | Override the router file (bypasses config) |

The CLI loads the config with `jiti`, so TypeScript configs work out-of-the-box without a build step.

## `triad test`

Runs every behavior in the router as an in-process test. Also runs channel behaviors.

```bash
triad test
triad test --bail
triad test --filter createPet
```

| Flag | Effect |
|---|---|
| `--bail` | Stop on first failure |
| `--filter <pattern>` | Only run endpoints/channels whose `name` contains `<pattern>` |

Reads from config: `test.setup`, `test.teardown`, `test.bail`. Exits 1 if any scenario fails or errors.

**Common failure modes:**
- `servicesFactory failed` → your `test-setup.ts` default export throws
- `Unrecognized assertion: "..."` → your `then` phrase doesn't match the parser — see the `triad-behaviors` skill
- `Handler returned status N which is not declared` → missing entry in `responses`
- `Response body for status N does not match declared schema` → handler output doesn't satisfy the declared schema

## `triad docs`

Generates OpenAPI 3.1 from HTTP endpoints. Also writes an AsyncAPI 3.0 **sibling file** if the router has channels.

```bash
triad docs
triad docs --output ./generated/api.yaml
triad docs --format json
```

| Flag | Effect |
|---|---|
| `-o, --output <path>` | Output path (default: `./generated/openapi.yaml`) |
| `-f, --format <format>` | `yaml` or `json` (defaults to file extension) |

Reads from config: `docs.output`, `docs.format`. When channels exist, writes `asyncapi.yaml` (or `.json`) beside the OpenAPI file.

> **Never hand-edit the output.** The next `triad docs` run will blow away your edits. If you need something Triad doesn't model, use the OpenAPI generator's `merge` option programmatically (see `@triadjs/openapi`).

## `triad gherkin`

Emits `.feature` files — one per bounded context (or one for root endpoints).

```bash
triad gherkin
triad gherkin --output ./docs/features
```

| Flag | Effect |
|---|---|
| `-o, --output <dir>` | Output directory (default: `./generated/features`) |

Reads from config: `gherkin.output`.

## `triad db generate`

Walks the router, reads `.storage()` hints, and emits a Drizzle schema file. See the `triad-drizzle` skill for the full dialect reference.

```bash
triad db generate                                   # sqlite → ./src/db/schema.generated.ts
triad db generate --dialect postgres
triad db generate --dialect mysql --output ./src/db/schema.mysql.ts
```

| Flag | Effect |
|---|---|
| `-o, --output <path>` | Output path (default: `./src/db/schema.generated.ts`) |
| `-d, --dialect <dialect>` | `sqlite`, `postgres`, or `mysql` (default: `sqlite`) |

Any model that contains at least one `.storage({ primaryKey: true })` field becomes a table. Models without primary-key hints are skipped silently.

## `triad validate`

Cross-artifact consistency checks:

1. No duplicate endpoint `name`s.
2. No duplicate `METHOD path` combinations.
3. Every endpoint declares at least one response.
4. Every `body matches <ModelName>` assertion references a model that exists in the router.
5. Endpoints inside a bounded context only use models declared in that context's `models[]` (warning — not error).

```bash
triad validate
triad validate --strict        # treat warnings as errors
triad validate --coverage      # warn about missing boundary coverage
```

Use `--strict` in CI so bounded-context leaks fail the build.

## `triad fuzz`

Generates boundary and adversarial scenarios for every endpoint from the schema constraints, without code changes. Equivalent to sprinkling `...scenario.auto()` across every endpoint.

```bash
triad fuzz
triad fuzz --random-valid 0    # deterministic only (no fast-check needed)
triad fuzz --seed 42           # reproducible randomness
```

Wire into CI as a gate alongside `triad test`.

## Typical `package.json` scripts

```json
{
  "scripts": {
    "dev": "tsx src/server.ts",
    "test": "triad test",
    "test:fuzz": "triad fuzz",
    "docs": "triad docs",
    "gherkin": "triad gherkin",
    "validate": "triad validate --strict",
    "db:generate": "triad db generate"
  }
}
```

## Checklist when things break

1. `triad.config.ts` present at or above the cwd? Otherwise pass `--config`.
2. `router` field in config points to a module with a **default export**? Named exports are ignored.
3. `test.setup` points to a module with a **default export** that returns a services object?
4. `teardown` name matches a method on the returned services object? Typos are silent — teardown errors are swallowed.
5. Peer deps installed? `@triadjs/fastify` needs `fastify` and optionally `@fastify/websocket`. `@triadjs/express` needs `express`.
6. For `db generate` failures: do your models have `.storage({ primaryKey: true })`? Models without PK hints are silently skipped.
