---
description: Run `triad docs` to regenerate OpenAPI 3.1 and (if the router has channels) AsyncAPI 3.0, then summarize what was written.
---

Load the `triad-cli` skill for command reference.

Run `triad docs` and report what was produced.

## Steps

1. Run `triad docs`. If `$ARGUMENTS` is non-empty and looks like a path, pass it as `--output`. If it's `json` or `yaml`, pass it as `--format`.

2. Check the exit code. If non-zero, surface the error — usually a router loading problem (bad path in `triad.config.ts`) or a schema generation issue (duplicate model names, missing references).

3. On success:
   - Report the output path(s) — both `openapi.yaml` and (if present) `asyncapi.yaml`
   - Read the first ~20 lines of the generated OpenAPI file and show the `info.title`, `info.version`, and a count of endpoints / schemas
   - Remind the user that hand-edits to the generated files will be overwritten on the next run

## When to use the `merge` option instead

If the user needs something Triad doesn't model (OAuth security schemes, webhooks, `x-*` vendor extensions, examples on specific operations), they should use the `generateOpenAPI(router, { merge: {...} })` option programmatically — NOT hand-edit the output. Point them at the `@triadjs/openapi` package's `merge` option and `onConflict` callback.

Example usage pattern (for reference, don't run automatically):

```ts
import { generateOpenAPI, toYaml } from '@triadjs/openapi';
import router from './src/app.js';
import { writeFileSync } from 'node:fs';

const doc = generateOpenAPI(router, {
  merge: {
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
  },
  onConflict: (c) => {
    throw new Error(`OpenAPI merge clobbered ${c.path}`);
  },
});

writeFileSync('./generated/openapi.yaml', toYaml(doc));
```

## Rules

- Never open `openapi.yaml` in an editor and save changes — the CLI will overwrite them.
- AsyncAPI is only emitted when the router has at least one channel. HTTP-only routers produce only `openapi.yaml`.
- `triad.config.ts → docs.output` controls the default path. Command-line `--output` overrides it.
