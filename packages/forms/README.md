# @triadjs/forms

Generate typed form validators from a Triad router. For every endpoint
with a request body, emits a `validateXxx(input)` function that returns
a discriminated `{ ok: true, value } | { ok: false, errors }` result.
Optionally emits thin adapter wrappers for [react-hook-form](https://react-hook-form.com)
and [@tanstack/form](https://tanstack.com/form).

The generated runtime is self-contained — it does NOT import
`@triadjs/core` at runtime, so your frontend bundle stays small.

## Install

```bash
npm install --save-dev @triadjs/forms
```

If you plan to use the adapter wrappers:

```bash
npm install react-hook-form          # optional
npm install @tanstack/react-form     # optional
```

## Usage

```bash
triad frontend generate --target forms --output ./src/generated/forms
```

Or via `triad.config.ts`:

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  frontend: {
    target: 'forms',
    output: './src/generated/forms',
    // reactHookForm: true,
    // tanstackForm: true,
  },
});
```

## Output layout

```
src/generated/forms/
  runtime.ts          — minimal evaluator (~140 lines, self-contained)
  types.ts            — every named interface referenced by a validator
  <context>.ts        — one file per bounded context with its validators
  react-hook-form.ts  — (optional) resolver wrappers
  tanstack-form.ts    — (optional) validator wrappers
  index.ts            — barrel
```

## Example generated validator

```ts
// Generated: library.ts
import { validateWith, type ValidationResult } from './runtime.js';
import type { CreateBook } from './types.js';

const validateCreateBookDescriptor = {
  kind: 'object',
  optional: false,
  nullable: false,
  fields: {
    title: { kind: 'string', optional: false, nullable: false },
    author: { kind: 'string', optional: false, nullable: false },
    isbn: { kind: 'string', optional: false, nullable: false },
    publishedYear: { kind: 'number', optional: false, nullable: false },
  },
} as const;

export function validateCreateBook(input: unknown): ValidationResult<CreateBook> {
  return validateWith<CreateBook>(validateCreateBookDescriptor, input);
}
```

## Using the raw validator

```ts
import { validateCreateBook } from './generated/forms/library.js';

const result = validateCreateBook(formValues);
if (!result.ok) {
  for (const err of result.errors) {
    console.error(`${err.path}: ${err.message}`);
  }
  return;
}
await api.createBook(result.value);
```

## Using with react-hook-form

With `reactHookForm: true`, the generator emits a `xxxResolver()`
factory that plugs directly into `useForm`:

```ts
import { useForm } from 'react-hook-form';
import { createBookResolver } from './generated/forms/react-hook-form.js';

const form = useForm({ resolver: createBookResolver() });
```

The resolver converts the `ValidationResult` errors into
react-hook-form's `{ [path]: { type, message } }` shape automatically.

## Using with @tanstack/form

With `tanstackForm: true`, the generator emits a `xxxValidator`
object that plugs into `useForm({ validators: {...} })`:

```ts
import { createBookValidator } from './generated/forms/tanstack-form.js';

const form = useForm({
  validators: { onChange: createBookValidator.onChange },
});
```

## Supported schema features (v1)

- Primitive types: `string`, `number`, `int32`, `datetime`, `boolean`
- `enum` (value-list check)
- `literal` (exact-value check)
- `array` (with recursive item validation)
- `model` / `value` (recursive object validation)
- Required vs optional (from `SchemaNode.isOptional`)
- Nullable vs non-nullable (from `SchemaNode.isNullable`)

Not yet supported (intentionally minimal for v1):

- `min` / `max` / `length` / `pattern` refinements
- `union` of primitives
- `tuple`
- `record`

These can be added later without breaking the generated API — just
richer descriptors + richer runtime checks.

## Design notes

- **Why JSON descriptors, not JSON Schema?** The descriptor is smaller,
  schema-library-agnostic, and easier to evolve. A JSON-Schema
  emitter could be added later alongside.
- **Why embed the runtime, not import `@triadjs/core`?** Bundle size —
  `@triadjs/core` pulls in OpenAPI machinery you don't need at form-
  validation time. The `runtime.ts` template is under 150 lines.
- **Why one file per bounded context?** Consistency with the other
  codegen packages (`@triadjs/tanstack-query`, `@triadjs/solid-query`,
  `@triadjs/vue-query`, `@triadjs/svelte-query`), so the output directory
  has a predictable shape regardless of target.
