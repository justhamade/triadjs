---
description: Run `triad test` and diagnose any failures, using the `triad-cli` and `triad-behaviors` skills to interpret errors precisely.
---

Load the `triad-cli` skill for command reference and the `triad-behaviors` skill for assertion failure diagnosis.

Run the Triad test suite for the current project and report results. If `$ARGUMENTS` is non-empty, pass it through as the filter: `triad test --filter $ARGUMENTS`.

## Steps

1. Run `triad test` (or `triad test --filter $ARGUMENTS` if arguments were provided). Capture both stdout and the exit code.

2. If every scenario passed, print a one-line summary and stop.

3. If scenarios failed, **diagnose each failure** using the categories below. Do NOT just re-print the runner output — translate it into an actionable fix.

## Failure categories and fixes

### `Unrecognized assertion: "..."`
The `then` phrase doesn't match any built-in pattern. Rewrite it using a phrase from the `triad-behaviors` skill phrase table. Common mistakes:
- Single quotes → use double quotes
- `"expect X to be Y"` → use `"response body has X \"Y\""`
- `"status is 201"` → use `"response status is 201"`
- `null` value → let the response schema enforce nullability instead

### `Handler returned status N which is not declared in this endpoint's responses`
The handler returned `ctx.respond[N](...)` or a raw `{ status: N, body }` for a status not in `responses`. Either add `N` to `responses` or fix the handler to return a declared status.

### `Response body for status N does not match declared schema: <path>: <message>`
The handler's output doesn't satisfy the response schema. Usually one of:
- Repository returned fields the DTO doesn't declare → `.pick(...)` to narrow
- Response DTO is missing a field the repository produces → add it to the model
- A `.nullable()` / `.optional()` mismatch → align the schema with what the handler actually returns

### `Behavior's request <part> does not satisfy the endpoint's declared schema`
The scenario's `.body()`/`.params()`/`.query()`/`.headers()` is missing a required field or has the wrong type. Fix the scenario's setup to match the schema, or fix the schema if the requirement is wrong.

### `servicesFactory failed: ...`
The `test-setup.ts` default-exported factory throws. Usually:
- Missing `better-sqlite3` native module (NODE_MODULE_VERSION mismatch) → `npm rebuild better-sqlite3`
- Missing peer dep → install it
- Factory references a file that doesn't exist → fix the path

### `Unknown model "X" in assertion`
The assertion references a model that isn't reachable from any endpoint's request or response in the router. Either use the model in an endpoint or pick a model that IS registered.

## What to report

- Total scenarios, pass/fail/error counts
- For each failure, the category (from the list above) and the specific fix
- If all failures share a common root cause, surface that first
- If the test run was filtered, remind the user they're seeing a subset
