---
description: Scaffold a new TriadJS backend project from scratch — package.json, schemas, an endpoint with behaviors, Fastify server, and test config.
---

Load the `using-triadjs` skill for framework context, then the `triad-schema`, `triad-endpoint`, `triad-services`, `triad-adapters`, and `triad-testing` sub-skills as needed.

Scaffold a complete, working TriadJS project based on the user's description ($ARGUMENTS). Do NOT ask a stream of clarifying questions — pick sensible defaults (sqlite + Fastify + ESM + TypeScript + tsx for dev) and proceed. If the user's description is vague, scaffold a generic "Items" CRUD API as a starting point.

## What to produce

Create this directory layout inside a subdirectory (or the current directory if empty):

```
package.json
tsconfig.json
triad.config.ts
src/
  schemas/
    <resource>.ts        # t.model + CreateX/UpdateX derivations + ApiError
  endpoints/
    <resource>.ts        # createX, getX, listX, updateX, deleteX with behaviors
  repositories/
    <resource>.ts        # in-memory repo as a starting point
  services.ts            # createServices + declare module augmentation
  test-setup.ts          # default-exported test services factory
  app.ts                 # createRouter + router.context with bounded context
  server.ts              # Fastify wiring
```

## Mandatory rules

1. **Default-export the router** from `src/app.ts`.
2. **Module-augment `ServiceContainer`** in `src/services.ts` — `declare module '@triadjs/core' { interface ServiceContainer extends AppServices {} }`.
3. **Every endpoint has at least one behavior scenario**, plus `...scenario.auto()` in the behaviors array for boundary coverage.
4. **Use `t.empty()` for 204 responses**, never `t.unknown().optional()`.
5. **Use `ctx.respond[status](body)`** exclusively — never raw `{ status, body }`.
6. **Assertion strings use double quotes**, match phrases from the `triad-behaviors` skill phrase table, and don't try to use `null`.
7. **`ApiError` model** is shared across every endpoint's 4xx responses.
8. **Pin `@triadjs/*` packages to `^0.2.1`** in `package.json` unless the user specifies otherwise.

## package.json scripts

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

## After scaffolding

1. Run `npm install` to verify dependencies resolve.
2. Run `triad test` and confirm every scenario passes against the in-memory repository.
3. Run `triad docs` and verify `generated/openapi.yaml` is produced.
4. Print a short summary: files created, commands to run, and what the user should do next (add more endpoints via `/triadjs:endpoint`, wire a real DB via `/triadjs:model` + `triad db generate`).

Do NOT run `triad db generate` during initial scaffolding — the in-memory repo doesn't need it. Leave that for when the user adds persistence.
