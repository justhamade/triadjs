/**
 * @triad/test-runner — execute Triad behaviors as in-process tests.
 *
 * ```ts
 * import { runBehaviors } from '@triad/test-runner';
 * import router from '../src/app';
 *
 * const summary = await runBehaviors(router, {
 *   servicesFactory: () => createTestServices(),
 *   teardown: (services) => services.cleanup(),
 * });
 *
 * console.log(`${summary.passed}/${summary.total} passed`);
 * ```
 *
 * Or integrate with Vitest/Jest:
 *
 * ```ts
 * import { describe, it } from 'vitest';
 * import { registerBehaviors } from '@triad/test-runner';
 * import router from '../src/app';
 *
 * registerBehaviors(router, { describe, it });
 * ```
 */

export {
  runBehaviors,
  runOneBehavior,
  type RunOptions,
} from './runner.js';

export {
  runChannelBehaviors,
  runOneChannelBehavior,
  runChannelAssertions,
  type RunChannelOptions,
} from './channel-runner.js';

export { ChannelHarness, type ConnectOptions } from './channel-harness.js';
export {
  ChannelTestClient,
  type ReceivedMessage,
} from './channel-client.js';

export {
  registerBehaviors,
  type RegisterOptions,
  type DescribeFn,
  type ItFn,
} from './vitest-adapter.js';

export {
  collectModels,
  type ModelRegistry,
} from './models.js';

export {
  substitute,
  substituteString,
  type Fixtures,
} from './substitute.js';

export {
  runAssertions,
  runSingleAssertion,
  getByPath,
  type CustomMatcher,
  type AssertionRunOptions,
} from './assertions.js';

export {
  AssertionFailure,
  summarize,
  type TestResult,
  type TestStatus,
  type TestFailure,
  type RunSummary,
  type ScenarioContext,
} from './results.js';

export {
  defineConfig,
  type TriadConfig,
  type TestConfig,
  type DocsConfig,
  type GherkinConfig,
} from './config.js';

export {
  describeEndpoint,
  describeSchema,
  type FieldDescriptor,
  type FieldConstraints,
  type EndpointDescriptor,
} from './schema-reader.js';

export {
  generateMissingFieldScenarios,
  generateBoundaryScenarios,
  generateInvalidEnumScenarios,
  generateTypeConfusionScenarios,
  generateRandomValidScenarios,
  buildBaseline,
  type AutoScenario,
  type AutoCategory,
} from './auto-generators.js';

export { expandAutoMarker } from './auto-expand.js';
export type { AutoBehavior } from './auto-expand.js';
