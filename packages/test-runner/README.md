# @triadjs/test-runner

In-process BDD test runner for Triad routers with schema-derived adversarial test generation.

## Install

```bash
npm install @triadjs/test-runner
```

## Quick Start

### Standalone runner

```ts
import { runBehaviors } from '@triadjs/test-runner';
import router from '../src/app.js';

const summary = await runBehaviors(router, {
  servicesFactory: () => createTestServices(),
  teardown: (services) => services.cleanup(),
});

console.log(`${summary.passed}/${summary.total} passed`);
```

### Vitest / Jest integration

```ts
import { describe, it } from 'vitest';
import { registerBehaviors } from '@triadjs/test-runner';
import router from '../src/app.js';

registerBehaviors(router, {
  describe,
  it,
  servicesFactory: () => createTestServices(),
  teardown: (services) => services.cleanup(),
});
```

Each endpoint becomes a `describe` block and each behavior becomes an `it`, so test reporters show scenario names as business rules.

## Features

- **Per-scenario isolation** -- `servicesFactory` is called before every scenario and `teardown` runs in a `finally` block, giving each test a clean slate.
- **Placeholder substitution** -- `{placeholder}` tokens in body, params, query, and headers are replaced with values from `given.fixtures` and the return value of `given.setup()`.
- **Response validation** -- handler responses are validated against the declared response schema for their status code, catching handlers that sidestep `ctx.respond`.
- **Custom matchers** -- pass a `CustomMatcher` map to extend the assertion engine beyond the built-in checks.

## Channel Testing

Test WebSocket channels with `runChannelBehaviors`:

```ts
import { runChannelBehaviors } from '@triadjs/test-runner';

const summary = await runChannelBehaviors(router, {
  servicesFactory: () => createTestServices(),
});
```

The channel runner follows the same per-scenario isolation pipeline as the HTTP runner -- fresh services, fixture substitution, teardown -- but drives a `ChannelHarness` that simulates WebSocket connections and message exchanges in-process.

## `scenario.auto()`

Schema-derived adversarial test generation. Add `scenario.auto()` to any endpoint and the runner reads its request schema at execution time to generate test cases automatically:

- **Missing fields** -- omits each required field one at a time
- **Boundary values** -- tests min/max lengths, numeric limits, and edge values
- **Type confusion** -- sends wrong types (string where number expected, etc.)
- **Invalid enums** -- sends values outside declared enum sets
- **Random fuzzing** -- generates N random valid payloads (configurable via `randomValid`)

All generated scenarios expect a `400` response, validating that the router rejects malformed input.

## CLI

```bash
# Run all behavior tests
npx triad test

# Run schema-derived fuzz tests
npx triad fuzz
```

## Links

- [Triad documentation](../../docs/)
- [Behavior testing guide](../../docs/guides/testing.md)
- [scenario.auto() guide](../../docs/guides/scenario-auto.md)
