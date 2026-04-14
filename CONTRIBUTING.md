# Contributing to Triad

Thanks for your interest. Triad is built in phases (see [`ROADMAP.md`](ROADMAP.md)). Before you open a PR, please read this document.

## Philosophy — read this first

Triad is opinionated. Contributions that conflict with these principles will not be accepted, no matter how technically good they are:

1. **Single source of truth.** One definition → types + validation + docs + tests. Never add features that create second sources of truth.
2. **Code-first TypeScript.** No YAML schemas, no code generation from DSLs, no `.triad` files. TypeScript is the authoring language.
3. **Declarative endpoints, fluent behaviors.** The only fluent API is `scenario().given().when().then().and()` — because BDD reads like a sentence. Everything else is a configuration object.
4. **Framework-agnostic core.** `@triadjs/core` does not depend on Express, Fastify, Hono, Node's `http`, or any specific HTTP framework. Adapters go in their own packages.
5. **AI-legible by design.** Every definition should be self-describing. An AI reading one endpoint file should understand the data shape, business rules, edge cases, and expected behaviors without chasing imports.
6. **Zero drift.** If the code compiles and the tests pass, the docs are correct. We enforce this by *producing* the docs from the code, never the other way around.

If your idea requires weakening any of these, the answer is probably "no" — but open an issue and let's talk first.

## Development setup

```bash
git clone https://github.com/<org>/triad.git
cd triad
npm install
npm run test      # runs all workspaces
npm run build     # tsup build for all workspaces
npm run typecheck # tsc --noEmit for all workspaces
```

Triad uses **npm workspaces** (not pnpm or yarn workspaces). Node 20+ required.

## Project structure

```
packages/
  core/         @triadjs/core — schema DSL, endpoint, behavior, router
  openapi/      @triadjs/openapi — OpenAPI 3.1 generator (Phase 3)
  gherkin/      @triadjs/gherkin — Gherkin .feature generator (Phase 4)
  test-runner/  @triadjs/test-runner — behavior test runner (Phase 5)
  cli/          @triadjs/cli — the `triad` CLI (Phase 6)
examples/
  petstore/     full working example
docs/           user-facing documentation
```

## TDD is non-negotiable

Every production line of code must be driven by a failing test. Red → Green → Refactor, strictly. A PR that adds functionality without tests will be closed.

For schema additions specifically, every new schema type needs:
- Construction + type inference test (`expectTypeOf`)
- Runtime validation test (valid + invalid cases)
- OpenAPI emission test
- Composition test if applicable (e.g. `.optional()`, `.nullable()`)

## Commit style

Conventional commits:

```
feat: add TupleSchema with min/max length
fix: correct nullable emission for $ref schemas
refactor: simplify InferShape conditional
docs: clarify ctx.respond runtime validation
test: cover edge case for enum.partial()
```

One logical change per commit. Do not bundle unrelated changes. Commit tests with the feature they test.

## TypeScript conventions

- Strict mode, `noUncheckedIndexedAccess`, no `any` without a justification comment
- `type` over `interface` except for classes and user-extensible declaration merging (`ServiceContainer`)
- Schemas are **immutable**: every chainable method returns a new instance
- No comments that restate what the code does. Comments explain *why*, not *what*
- No runtime dependencies in `@triadjs/core`. Ever.

## How to add a new schema primitive

1. Write the test file first (`__tests__/schema/my-schema.test.ts`)
2. Create the class in `src/schema/my-schema.ts`, extending `SchemaNode<TOutput>`
3. Implement `_clone`, `_validate`, `_toOpenAPI`, plus `optional()` / `nullable()` overrides for concrete-type chainability
4. Use conditional type inference (`T extends SchemaNode<infer U> ? U : never`) for any generic extraction — never rely on `T['_output']` through deep composition
5. Add a factory to `src/schema/index.ts` (the `t` namespace). Use `const` type parameters (`<const V extends ...>`) when preserving literal types matters
6. Export from `src/index.ts`

## How to add a new assertion type to behaviors

1. Add a case to the `Assertion` union in `src/behavior.ts`
2. Add a parser branch in `parseAssertion()`
3. Add tests for the new parser branch
4. When Phase 5 lands, add a runner implementation for the assertion

## Issue labels

- `good first issue` — self-contained, small scope
- `design-discussion` — requires API design debate before implementation
- `phase:2`, `phase:3` etc. — which roadmap phase this belongs to
- `breaking` — would require a major version bump

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
