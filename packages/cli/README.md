# @triadjs/cli

The `triad` CLI — test, docs, validate, fuzz, mock, scaffold, and frontend codegen from a single source of truth.

## Install

```bash
npm install @triadjs/cli
```

The `triad` binary is added to your PATH automatically.

## Commands

| Command | Description |
| --- | --- |
| `triad test` | Run every behavior in the router as an in-process test (`--bail`, `--filter <pattern>`) |
| `triad docs` | Generate an OpenAPI 3.1 document (`--output`, `--format yaml\|json`) |
| `triad docs check` | Diff current OpenAPI against a baseline and classify changes as safe, risky, or breaking (`--against <ref>`, `--allow-breaking`) |
| `triad gherkin` | Export Gherkin `.feature` files from the router (`--output <dir>`) |
| `triad validate` | Cross-artifact consistency checks (`--strict`, `--coverage`) |
| `triad fuzz` | Schema-derived adversarial testing (`--runs <n>`, `--seed <n>`, `--categories`, `--fail-fast`) |
| `triad mock` | Start a mock HTTP server with schema-valid fake responses (`--port`, `--latency`, `--error-rate`, `--seed`) |
| `triad new` | Scaffold a new project from a built-in template: `fastify-petstore`, `express-tasktracker`, `fastify-bookshelf`, `hono-supabase` (`--template`, `--force`) |
| `triad db generate` | Generate Drizzle table definitions from router schemas (`--dialect sqlite\|postgres\|mysql`, `--output`) |
| `triad db migrate` | Diff the router against the last snapshot and write an SQL migration (`--dialect`, `--dir`, `--name`) |
| `triad frontend generate` | Generate typed frontend clients: `tanstack-query`, `channel-client`, `channel-client-react`, `channel-client-solid`, `channel-client-vue`, `channel-client-svelte` (`--target`, `--output`, `--base-url`) |

## Global options

```
-c, --config <path>   Path to triad.config.ts
-r, --router <path>   Override the router path
-V, --version         Print version
```

## Configuration

Create a `triad.config.ts` in your project root:

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
  docs: {
    output: './generated/openapi.yaml',
  },
  gherkin: {
    output: './generated/features',
  },
});
```

All CLI commands read this config file automatically. Override it per-invocation with `--config`.

## Examples

```bash
# Run all behavior tests, stop on first failure
triad test --bail

# Generate OpenAPI YAML
triad docs --format yaml --output openapi.yaml

# Fuzz all endpoints with 50 random inputs, deterministic seed
triad fuzz --runs 50 --seed 42

# Start a mock server on port 4000
triad mock --port 4000

# Scaffold a new project
triad new my-app --template fastify-petstore

# Generate Drizzle schema for Postgres
triad db generate --dialect postgres --output src/db/schema.ts

# Generate TanStack Query hooks
triad frontend generate --target tanstack-query --output src/api
```

## Links

- [Triad documentation](../../docs/)
- [Drizzle integration guide](../../docs/drizzle-integration.md)
