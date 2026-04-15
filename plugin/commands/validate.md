---
description: Run `triad validate --strict` and fix any consistency issues — duplicate endpoint names, duplicate routes, missing responses, unknown model references, or bounded-context leaks.
---

Load the `triad-cli` skill for command reference, and `triad-endpoint` or `triad-schema` depending on what the validator surfaces.

Run `triad validate --strict` and act on the output.

## Steps

1. Run `triad validate --strict`. If `$ARGUMENTS` contains `--coverage`, include it as well.

2. Parse the output. The validator checks:
   1. No duplicate endpoint `name`s (operationId collisions in OpenAPI)
   2. No duplicate `METHOD path` combinations
   3. Every endpoint declares at least one response
   4. Every `response body matches <ModelName>` assertion references a model that exists in the router
   5. Endpoints inside a bounded context only use models declared in that context's `models[]`

3. For each finding, propose a specific fix:

### Duplicate endpoint name
Rename the newer endpoint to something unique. OpenAPI uses `name` as `operationId`, so collisions produce silent bugs in generated clients.

### Duplicate `METHOD path`
Two endpoints claim the same route. Usually a copy-paste mistake. Merge them or change one path.

### Missing response
Every endpoint needs at least one entry in `responses`. Even a 204 needs `responses: { 204: { schema: t.empty(), description: '...' } }`.

### Unknown model in assertion
A behavior uses `'response body matches Pet'` but `Pet` isn't registered on the router (not reachable from any endpoint's request or response). Either add the model to an endpoint's schemas or rewrite the assertion to a different model.

### Bounded-context leak (warning → error in `--strict`)
An endpoint inside `router.context('Pets', { models: [Pet, ...] })` uses a model that isn't in `models[]`. Either add it to the context's `models[]` (if it legitimately belongs) or move the endpoint to the right context.

4. After fixing, re-run `triad validate --strict` to confirm all issues cleared.

## Rules

- `--strict` turns warnings into errors — bounded-context leaks fail the build. Use `--strict` in CI.
- `--coverage` warns about endpoints missing boundary coverage (schema constraints with no test hitting them). Add `...scenario.auto()` to the endpoint's behaviors to fix.
- Validator findings are rarely "just rewrite the code" — usually they surface real modeling bugs. Take each one seriously before suppressing it.
