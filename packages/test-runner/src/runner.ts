/**
 * The behavior test runner.
 *
 * `runBehaviors(router, options)` walks every endpoint in the router, runs
 * each behavior as an in-process test, and returns structured results.
 * Nothing about this runner talks HTTP: handlers are invoked directly with
 * a synthetic `HandlerContext`. This matches Triad's framework-agnostic
 * core and makes tests fast and deterministic.
 *
 * Future options (not v1): a supertest-based runner for endpoints wired
 * into an actual Express/Fastify/Hono adapter, and a cross-process runner
 * for language interop.
 *
 * Per-scenario flow:
 *
 *   1. Call `servicesFactory()` (if provided) to get a fresh service
 *      container. This provides isolation between scenarios — each test
 *      gets a clean slate.
 *   2. Call `behavior.given.setup(services)` to seed test data. Merge the
 *      returned fixtures with `behavior.given.fixtures`.
 *   3. Substitute `{placeholder}` tokens in body/params/query/headers
 *      using the merged fixtures.
 *   4. Build a `HandlerContext` with `ctx.respond` from `buildRespondMap`
 *      so outgoing payloads are schema-validated on the way out.
 *   5. Invoke `endpoint.handler(ctx)`. Any thrown error becomes a failure
 *      result (not a crash).
 *   6. Validate the returned `HandlerResponse` against the declared
 *      response schema for its status code — this catches handlers that
 *      sidestep `ctx.respond`.
 *   7. Run each parsed `Assertion` against the response.
 *   8. Call `teardown(services)` in a `finally` block so cleanup always
 *      runs — even after failures.
 */

import {
  type Router,
  type Endpoint,
  type Behavior,
  type HandlerResponse,
  type ServiceContainer,
  type ResponsesConfig,
  type HandlerContext,
  ValidationException,
  buildRespondMap,
} from '@triad/core';

import {
  summarize,
  type TestResult,
  type TestFailure,
  type RunSummary,
  AssertionFailure,
} from './results.js';
import { collectModels, type ModelRegistry } from './models.js';
import { substitute, type Fixtures } from './substitute.js';
import { runAssertions, type CustomMatcher } from './assertions.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
  /**
   * Called before every scenario to produce a fresh services container.
   * If omitted, an empty object is used. For database-backed tests,
   * return a services container bound to a clean schema or transaction
   * that can be rolled back in `teardown`.
   */
  servicesFactory?: () =>
    | Promise<ServiceContainer>
    | ServiceContainer;

  /** Called after every scenario for cleanup — runs even on failure. */
  teardown?: (
    services: ServiceContainer,
  ) => Promise<void> | void;

  /** Filter which endpoints are executed. */
  filter?: (endpoint: Endpoint) => boolean;

  /** Stop on first failure (default: false). */
  bail?: boolean;

  /** User-provided matchers for `{ type: 'custom' }` assertions. */
  customMatchers?: Record<string, CustomMatcher>;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Run every behavior in the router and return a summary. */
export async function runBehaviors(
  router: Router,
  options: RunOptions = {},
): Promise<RunSummary> {
  const results: TestResult[] = [];
  const models = collectModels(router);

  outer: for (const endpoint of router.allEndpoints()) {
    if (options.filter && !options.filter(endpoint)) continue;

    for (const behavior of endpoint.behaviors) {
      const result = await runOneBehavior(endpoint, behavior, models, options);
      results.push(result);
      if (options.bail && (result.status === 'failed' || result.status === 'errored')) {
        break outer;
      }
    }
  }

  return summarize(results);
}

/**
 * Run a single behavior and return its result. Exposed so test framework
 * adapters (Vitest, Jest) can drive behaviors one at a time and hook them
 * into native `it()` blocks for per-test reporting.
 */
export async function runOneBehavior(
  endpoint: Endpoint,
  behavior: Behavior,
  models: ModelRegistry,
  options: RunOptions = {},
): Promise<TestResult> {
  const start = performance.now();
  const baseResult = {
    endpointName: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    scenario: behavior.scenario,
  } as const;

  let services: ServiceContainer = {};

  try {
    services = options.servicesFactory
      ? await options.servicesFactory()
      : ({} as ServiceContainer);
  } catch (err) {
    return {
      ...baseResult,
      status: 'errored',
      failure: toFailure(err, 'servicesFactory failed'),
      durationMs: performance.now() - start,
    };
  }

  try {
    // Step 1: Run setup() and merge fixtures
    let fixtures: Fixtures = { ...(behavior.given.fixtures ?? {}) };
    if (behavior.given.setup) {
      const seeded = await behavior.given.setup(services);
      if (seeded && typeof seeded === 'object') {
        fixtures = { ...fixtures, ...seeded };
      }
    }

    // Step 2: Substitute placeholders in request data
    const rawBody = substitute(behavior.given.body, fixtures);
    const rawParams = substitute(behavior.given.params ?? {}, fixtures);
    const rawQuery = substitute(behavior.given.query ?? {}, fixtures);
    const rawHeaders = substitute(behavior.given.headers ?? {}, fixtures);

    // Step 3: Validate each request part against its declared schema.
    // This applies defaults (`t.int32().default(20)`) and catches behavior
    // mistakes (e.g. a scenario that sets `.params({ id: 'not-a-uuid' })`
    // when the endpoint declares `id: t.string().format('uuid')`). Matches
    // the Fastify adapter's validation pipeline so the test runner sees
    // the same data the real HTTP handler would.
    let params: unknown = rawParams;
    let query: unknown = rawQuery;
    let body: unknown = rawBody;
    let headers: unknown = rawHeaders;

    const paramsResult = endpoint.request.params
      ? endpoint.request.params.validate(rawParams)
      : undefined;
    if (paramsResult?.success === false) {
      return requestValidationFailure(
        baseResult,
        'params',
        paramsResult.errors,
        start,
      );
    }
    if (paramsResult?.success === true) params = paramsResult.data;

    const queryResult = endpoint.request.query
      ? endpoint.request.query.validate(rawQuery)
      : undefined;
    if (queryResult?.success === false) {
      return requestValidationFailure(
        baseResult,
        'query',
        queryResult.errors,
        start,
      );
    }
    if (queryResult?.success === true) query = queryResult.data;

    const bodyResult = endpoint.request.body
      ? endpoint.request.body.validate(rawBody)
      : undefined;
    if (bodyResult?.success === false) {
      return requestValidationFailure(
        baseResult,
        'body',
        bodyResult.errors,
        start,
      );
    }
    if (bodyResult?.success === true) body = bodyResult.data;

    const headersResult = endpoint.request.headers
      ? endpoint.request.headers.validate(rawHeaders)
      : undefined;
    if (headersResult?.success === false) {
      return requestValidationFailure(
        baseResult,
        'headers',
        headersResult.errors,
        start,
      );
    }
    if (headersResult?.success === true) headers = headersResult.data;

    // Step 4: Build the handler context
    const ctx = buildContext(endpoint, {
      params: params as Record<string, unknown>,
      query: query as Record<string, unknown>,
      body,
      headers: headers as Record<string, unknown>,
      services,
    });

    // Step 4: Invoke the handler
    let response: HandlerResponse;
    try {
      response = await endpoint.handler(ctx);
    } catch (err) {
      // ctx.respond throws ValidationException on invalid outgoing payload
      if (err instanceof ValidationException) {
        return {
          ...baseResult,
          status: 'failed',
          failure: {
            message: `Handler produced an invalid response body for its declared schema: ${err.errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join(', ')}`,
            stack: err.stack,
          },
          durationMs: performance.now() - start,
        };
      }
      return {
        ...baseResult,
        status: 'errored',
        failure: toFailure(err, 'Handler threw'),
        durationMs: performance.now() - start,
      };
    }

    // Step 5: Validate the response against its declared schema
    // (safety net for handlers that don't go through ctx.respond).
    const responseConfig = endpoint.responses[response.status];
    if (!responseConfig) {
      return {
        ...baseResult,
        status: 'failed',
        failure: {
          message: `Handler returned status ${response.status} which is not declared in this endpoint's responses (declared: ${Object.keys(endpoint.responses).join(', ')})`,
          actualStatus: response.status,
          actualBody: response.body,
        },
        durationMs: performance.now() - start,
      };
    }
    const validation = responseConfig.schema.validate(response.body);
    if (!validation.success) {
      const first = validation.errors[0];
      return {
        ...baseResult,
        status: 'failed',
        failure: {
          message: `Response body for status ${response.status} does not match declared schema: ${first?.path || '<root>'}: ${first?.message}`,
          actualStatus: response.status,
          actualBody: response.body,
        },
        durationMs: performance.now() - start,
      };
    }

    // Step 6: Run the behavior's assertions
    try {
      await runAssertions(response, behavior.then, {
        models,
        fixtures,
        ...(options.customMatchers ? { customMatchers: options.customMatchers } : {}),
      });
    } catch (err) {
      if (err instanceof AssertionFailure) {
        return {
          ...baseResult,
          status: 'failed',
          failure: {
            ...(err.assertion ? { assertion: err.assertion } : {}),
            message: err.message,
            actualStatus: response.status,
            actualBody: response.body,
          },
          durationMs: performance.now() - start,
        };
      }
      return {
        ...baseResult,
        status: 'errored',
        failure: toFailure(err, 'Assertion execution errored'),
        durationMs: performance.now() - start,
      };
    }

    return {
      ...baseResult,
      status: 'passed',
      durationMs: performance.now() - start,
    };
  } finally {
    if (options.teardown) {
      try {
        await options.teardown(services);
      } catch {
        // Teardown failures are swallowed — a test's result should not
        // depend on cleanup. A future option can surface them if needed.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CtxInputs {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
  services: ServiceContainer;
}

function buildContext(
  endpoint: Endpoint,
  inputs: CtxInputs,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): HandlerContext<any, any, any, any, ResponsesConfig> {
  return {
    params: inputs.params,
    query: inputs.query,
    body: inputs.body,
    headers: inputs.headers,
    services: inputs.services,
    respond: buildRespondMap(endpoint.responses),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as HandlerContext<any, any, any, any, ResponsesConfig>;
}

function toFailure(err: unknown, prefix: string): TestFailure {
  if (err instanceof Error) {
    return {
      message: `${prefix}: ${err.message}`,
      stack: err.stack,
    };
  }
  return { message: `${prefix}: ${String(err)}` };
}

function requestValidationFailure(
  base: {
    endpointName: string;
    method: string;
    path: string;
    scenario: string;
  },
  part: string,
  errors: readonly import('@triad/core').ValidationError[],
  start: number,
): TestResult {
  const details = errors
    .map((e) => `${e.path || '<root>'}: ${e.message}`)
    .join(', ');
  return {
    ...base,
    status: 'failed',
    failure: {
      message:
        `Behavior's request ${part} does not satisfy the endpoint's ` +
        `declared schema. This usually means the scenario's ${part} is ` +
        `missing a required field, has the wrong type, or uses a value ` +
        `the schema rejects. Details: ${details}`,
    },
    durationMs: performance.now() - start,
  };
}
