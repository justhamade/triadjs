/**
 * Behavior runner for WebSocket channels.
 *
 * Mirrors `runner.ts` (the HTTP runner) structurally — same options
 * bag, same per-scenario isolation pipeline, same `TestResult` shape —
 * but drives a `ChannelHarness` instead of calling an HTTP handler.
 *
 * Per-scenario flow:
 *
 *   1. Build fresh services via `servicesFactory()`.
 *   2. Run `given.setup(services)` and merge its return value with
 *      `given.fixtures` to form the substitution fixtures.
 *   3. Substitute `{placeholder}` tokens in `given.body`, `given.params`,
 *      `given.query`, and `given.headers`.
 *   4. Construct a fresh `ChannelHarness` bound to this channel +
 *      services.
 *   5. Interpret `behavior.when.description` to decide which harness
 *      actions to perform. See `executeWhen` for the recognized
 *      patterns and fallback behavior.
 *   6. Run the behavior's assertions through `runChannelAssertions`.
 *   7. Teardown runs in a `finally` block — same guarantee the HTTP
 *      runner provides.
 *
 * Why heuristic `when` parsing: a channel scenario describes
 * conversational actions ("client connects", "alice sends a message")
 * rather than a single request. We'd need a full separate DSL to
 * describe these unambiguously, and most teams have one or two common
 * shapes (one client sending one message, or two clients where one
 * sends and one receives). The heuristic parser covers those cases and
 * degrades gracefully — anything it doesn't understand falls back to
 * "create one client and send the first declared clientMessage type
 * with `given.body` as the payload". That keeps the ergonomic common
 * case working while leaving an escape hatch for more complex flows
 * via direct harness use in tests.
 */

import {
  type Router,
  type Channel,
  type Behavior,
  type Assertion,
  type ServiceContainer,
  ValidationException,
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
import type { CustomMatcher } from './assertions.js';
import type { RunOptions } from './runner.js';
import { ChannelHarness } from './channel-harness.js';
import { ChannelTestClient } from './channel-client.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for `runChannelBehaviors`. Intentionally the same shape as
 * the HTTP runner's `RunOptions` minus the endpoint-specific
 * `filter` — we provide a channel-specific filter instead.
 */
export interface RunChannelOptions
  extends Omit<RunOptions, 'filter' | 'customMatchers'> {
  /** Filter which channels are executed. */
  filter?: (channel: Channel) => boolean;
  /** User-provided matchers for unrecognized channel assertions. */
  customMatchers?: Record<string, CustomMatcher>;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Run every channel behavior in the router and return a summary. */
export async function runChannelBehaviors(
  router: Router,
  options: RunChannelOptions = {},
): Promise<RunSummary> {
  const results: TestResult[] = [];
  const models = collectModels(router);

  outer: for (const channel of router.allChannels()) {
    if (options.filter && !options.filter(channel)) continue;

    for (const behavior of channel.behaviors) {
      const result = await runOneChannelBehavior(
        channel,
        behavior,
        models,
        options,
      );
      results.push(result);
      if (
        options.bail &&
        (result.status === 'failed' || result.status === 'errored')
      ) {
        break outer;
      }
    }
  }

  return summarize(results);
}

/**
 * Run a single channel behavior. Exposed so vitest/jest adapters can
 * drive channel behaviors one at a time and wire them into native
 * `it()` blocks.
 */
export async function runOneChannelBehavior(
  channel: Channel,
  behavior: Behavior,
  models: ModelRegistry,
  options: RunChannelOptions = {},
): Promise<TestResult> {
  const start = performance.now();
  const baseResult = {
    endpointName: channel.name,
    // Use WS as the pseudo-method so reporters can distinguish channel
    // scenarios from HTTP ones without a schema change to TestResult.
    method: 'WS',
    path: channel.path,
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
    // ---- 1. Fixtures ----------------------------------------------------
    let fixtures: Fixtures = { ...(behavior.given.fixtures ?? {}) };
    if (behavior.given.setup) {
      const seeded = await behavior.given.setup(services);
      if (seeded && typeof seeded === 'object') {
        fixtures = { ...fixtures, ...seeded };
      }
    }

    // ---- 2. Substitute --------------------------------------------------
    const body = substitute(behavior.given.body, fixtures);
    const params = substitute(
      behavior.given.params ?? {},
      fixtures,
    ) as Record<string, unknown>;
    const query = substitute(
      behavior.given.query ?? {},
      fixtures,
    ) as Record<string, unknown>;
    const headers = substitute(
      behavior.given.headers ?? {},
      fixtures,
    ) as Record<string, unknown>;

    // ---- 3. Harness -----------------------------------------------------
    const harness = new ChannelHarness(channel, services);

    // ---- 4. Execute `when` ----------------------------------------------
    let lastClient: ChannelTestClient | undefined;
    try {
      lastClient = await executeWhen(harness, behavior.when.description, {
        body,
        params,
        query,
        headers,
        channel,
      });
    } catch (err) {
      if (err instanceof ValidationException) {
        return {
          ...baseResult,
          status: 'failed',
          failure: {
            message: `Channel handler produced an invalid outgoing message for its declared schema: ${err.errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join(', ')}`,
            stack: err.stack,
          },
          durationMs: performance.now() - start,
        };
      }
      return {
        ...baseResult,
        status: 'errored',
        failure: toFailure(err, 'Channel handler threw'),
        durationMs: performance.now() - start,
      };
    }

    // ---- 5. Assertions --------------------------------------------------
    try {
      await runChannelAssertions(harness, lastClient, behavior.then, {
        models,
        fixtures,
        customMatchers: options.customMatchers,
      });
    } catch (err) {
      if (err instanceof AssertionFailure) {
        return {
          ...baseResult,
          status: 'failed',
          failure: {
            ...(err.assertion ? { assertion: err.assertion } : {}),
            message: err.message,
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
        // Swallow teardown errors — same rationale as the HTTP runner.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// `when` interpretation
// ---------------------------------------------------------------------------

interface WhenInputs {
  body: unknown;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  channel: Channel;
}

/** Default client id used when the scenario doesn't name one. */
const DEFAULT_CLIENT = 'client';

/**
 * Drive the harness based on the `when` description.
 *
 * Recognized patterns (anchored, case-sensitive except where noted):
 *
 *   - `client connects` / `a client connects` — connect the default
 *     client with the scenario's params/query/headers.
 *   - `<name> connects` — connect a named client.
 *   - `client sends <messageType>` — send from the default client.
 *     If the default client hasn't been connected, the runner
 *     auto-connects it first with the scenario's params.
 *   - `<name> sends <messageType>` — send from a named client.
 *     Auto-connects the named client if not already present.
 *   - `client disconnects` / `<name> disconnects` — disconnect.
 *
 * Fallback: if none of the above match, connect the default client
 * and send the first declared `clientMessages` key with `given.body`
 * as the payload. This keeps the "I have one channel with one
 * message type" case zero-config.
 *
 * Returns the most recently acted-on client, which the assertion
 * executor uses as the default target for `connection_rejected` and
 * similar single-client assertions.
 */
async function executeWhen(
  harness: ChannelHarness,
  description: string,
  inputs: WhenInputs,
): Promise<ChannelTestClient | undefined> {
  const text = description.trim();

  // "<name> connects" / "client connects" / "a client connects"
  const connectMatch = text.match(/^(?:a )?(\w+) connects$/i);
  if (connectMatch) {
    const name =
      connectMatch[1]!.toLowerCase() === 'client'
        ? DEFAULT_CLIENT
        : connectMatch[1]!;
    return await harness.connect(name, {
      params: inputs.params,
      query: inputs.query,
      headers: inputs.headers,
    });
  }

  // "<name> disconnects" / "client disconnects"
  const disconnectMatch = text.match(/^(\w+) disconnects$/i);
  if (disconnectMatch) {
    const name =
      disconnectMatch[1]!.toLowerCase() === 'client'
        ? DEFAULT_CLIENT
        : disconnectMatch[1]!;
    const existing = harness.getClient(name);
    await harness.disconnect(name);
    return existing;
  }

  // "<name> sends <messageType>" or "client sends <messageType>"
  // Optional trailing "with ..." is ignored — `given.body` is the
  // source of truth for payloads, the description is documentation.
  const sendMatch = text.match(/^(\w+) sends (\w+)(?:\s.*)?$/i);
  if (sendMatch) {
    const rawName = sendMatch[1]!;
    const messageType = sendMatch[2]!;
    const name =
      rawName.toLowerCase() === 'client' ? DEFAULT_CLIENT : rawName;
    const connected = await ensureConnected(harness, name, inputs);
    // Skip `send` entirely if the connection was rejected — `send`
    // would throw "no client with id X is connected" and mask the
    // rejection outcome the scenario is actually testing.
    if (!connected.rejected) {
      await harness.send(name, messageType, inputs.body);
    }
    return harness.getClient(name) ?? connected;
  }

  // ---- Fallback -------------------------------------------------------
  // Create the default client and send the first declared
  // clientMessages key. This is the "happy path" shape for a channel
  // scenario: one client, one message type, assertions on the
  // broadcast.
  //
  // Crucially we KEEP the client returned by `ensureConnected` even
  // when it was rejected. `harness.getClient(DEFAULT_CLIENT)` returns
  // `undefined` for rejected clients (they never enter the registry),
  // which used to hide the rejection outcome from assertions like
  // `connection is rejected with code 401`.
  const connected = await ensureConnected(harness, DEFAULT_CLIENT, inputs);
  if (connected.rejected) {
    return connected;
  }
  const clientMsgKeys = Object.keys(inputs.channel.clientMessages);
  if (clientMsgKeys.length > 0 && inputs.body !== undefined) {
    // Prefer an exact keyword match embedded in the description.
    const matched = clientMsgKeys.find((k) =>
      new RegExp(`\\b${k}\\b`).test(text),
    );
    const messageType = matched ?? clientMsgKeys[0]!;
    await harness.send(DEFAULT_CLIENT, messageType, inputs.body);
  }
  return harness.getClient(DEFAULT_CLIENT) ?? connected;
}

/**
 * Connect a client if it isn't already registered. Lets scenarios
 * write `alice sends chat` without a separate connect step when
 * there's no reason to treat the handshake as a distinct event.
 *
 * Returns the connected (or rejected) client so callers can observe
 * the outcome — critical for the fallback branch of `executeWhen`,
 * where rejection assertions need to see the client that was just
 * connected even though rejected clients never enter the harness's
 * internal registry via `getClient`.
 */
async function ensureConnected(
  harness: ChannelHarness,
  clientId: string,
  inputs: WhenInputs,
): Promise<ChannelTestClient> {
  const existing = harness.getClient(clientId);
  if (existing) return existing;
  return await harness.connect(clientId, {
    params: inputs.params,
    query: inputs.query,
    headers: inputs.headers,
  });
}

// ---------------------------------------------------------------------------
// Channel assertion executor
// ---------------------------------------------------------------------------

interface ChannelAssertionOptions {
  models: ModelRegistry;
  fixtures: Fixtures;
  customMatchers?: Record<string, CustomMatcher>;
}

/**
 * Run channel-specific assertions against the harness state plus the
 * most recently acted-on client. Structural HTTP assertions
 * (`status`, `body_matches`, `body_has`, etc.) are NOT handled here
 * — they don't make sense for channels and will fall through to a
 * clear error message. Users should use the channel assertion
 * vocabulary instead.
 */
export async function runChannelAssertions(
  harness: ChannelHarness,
  lastClient: ChannelTestClient | undefined,
  assertions: readonly Assertion[],
  options: ChannelAssertionOptions,
): Promise<void> {
  for (const assertion of assertions) {
    await runOneChannelAssertion(harness, lastClient, assertion, options);
  }
}

function resolveClients(
  harness: ChannelHarness,
  lastClient: ChannelTestClient | undefined,
  clientId: string,
): ChannelTestClient[] {
  if (clientId === '*') return harness.allClients();
  // `client` is the default-client alias used by the fallback path.
  if (clientId === 'client') {
    const c = harness.getClient(DEFAULT_CLIENT) ?? lastClient;
    return c ? [c] : [];
  }
  const c = harness.getClient(clientId);
  return c ? [c] : [];
}

async function runOneChannelAssertion(
  harness: ChannelHarness,
  lastClient: ChannelTestClient | undefined,
  assertion: Assertion,
  options: ChannelAssertionOptions,
): Promise<void> {
  switch (assertion.type) {
    case 'channel_receives': {
      const targets = resolveClients(harness, lastClient, assertion.client);
      if (targets.length === 0) {
        throw new AssertionFailure(
          `No clients matched "${assertion.client}" for assertion: ${assertion.raw}`,
          assertion,
        );
      }
      for (const client of targets) {
        if (client.receivedOf(assertion.messageType).length === 0) {
          throw new AssertionFailure(
            `Expected client "${client.id}" to have received a "${assertion.messageType}" message, but it did not. Received types: [${client.received.map((m) => m.type).join(', ') || '(none)'}]`,
            assertion,
          );
        }
      }
      return;
    }

    case 'channel_not_receives': {
      const targets = resolveClients(harness, lastClient, assertion.client);
      for (const client of targets) {
        if (client.receivedOf(assertion.messageType).length > 0) {
          throw new AssertionFailure(
            `Expected client "${client.id}" NOT to have received a "${assertion.messageType}" message, but it did`,
            assertion,
          );
        }
      }
      return;
    }

    case 'connection_rejected': {
      if (!lastClient) {
        throw new AssertionFailure(
          `connection_rejected assertion requires a client from the \`when\` step`,
          assertion,
        );
      }
      if (!lastClient.rejected) {
        throw new AssertionFailure(
          `Expected connection for client "${lastClient.id}" to be rejected with code ${assertion.code}, but it was accepted`,
          assertion,
        );
      }
      if (lastClient.rejectedCode !== assertion.code) {
        throw new AssertionFailure(
          `Expected rejection code ${assertion.code}, got ${lastClient.rejectedCode ?? '(none)'}`,
          assertion,
        );
      }
      return;
    }

    case 'channel_message_has': {
      const expected = substitute(assertion.value, options.fixtures);
      const targets = resolveClients(harness, lastClient, assertion.client);
      if (targets.length === 0) {
        throw new AssertionFailure(
          `No clients matched "${assertion.client}" for assertion: ${assertion.raw}`,
          assertion,
        );
      }
      // `messageType === '*'` means "check the most recent message on
      // the default/last client". Otherwise, the assertion checks
      // EVERY target's messages of the named type and requires at
      // least one to satisfy the field check.
      let matched = false;
      for (const client of targets) {
        const candidates =
          assertion.messageType === '*'
            ? client.received.slice(-1)
            : client.receivedOf(assertion.messageType);
        for (const msg of candidates) {
          const actual = getByPath(msg.data, assertion.path);
          if (deepEqual(actual, expected)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) {
        throw new AssertionFailure(
          `Expected a ${assertion.messageType === '*' ? 'message' : `"${assertion.messageType}" message`} with ${assertion.path} = ${JSON.stringify(expected)}, but no matching message was found`,
          assertion,
        );
      }
      return;
    }

    // HTTP assertions that don't apply to channels — surface clearly
    // so a user who copy-pasted an HTTP scenario into a channel gets
    // a helpful message instead of a confusing pass.
    case 'status':
    case 'body_matches':
    case 'body_has':
    case 'body_is_array':
    case 'body_is_empty':
    case 'body_length':
    case 'body_has_code': {
      throw new AssertionFailure(
        `Assertion "${assertion.raw}" is an HTTP response assertion and does not apply to channel behaviors. Use channel assertions like "alice receives a message event" or "connection is rejected with code 401" instead.`,
        assertion,
      );
    }

    case 'custom': {
      // Same escape hatch as the HTTP runner — look for a matcher
      // whose key is a substring of the raw text. Custom matchers
      // receive a pseudo-response so existing matchers designed for
      // HTTP don't crash if the user reused one.
      if (options.customMatchers) {
        for (const [key, matcher] of Object.entries(options.customMatchers)) {
          if (assertion.raw.includes(key)) {
            await matcher(
              { status: 0, body: undefined } as never,
              assertion as Extract<Assertion, { type: 'custom' }>,
            );
            return;
          }
        }
      }
      throw new AssertionFailure(
        `Unrecognized channel assertion: "${assertion.raw}". Rewrite it using a supported pattern (e.g. "alice receives a message event", "connection is rejected with code 401", "message has text \\"hi\\"") or register a matcher via runChannelBehaviors(router, { customMatchers: { ... } }).`,
        assertion,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFailure(err: unknown, prefix: string): TestFailure {
  if (err instanceof Error) {
    return { message: `${prefix}: ${err.message}`, stack: err.stack };
  }
  return { message: `${prefix}: ${String(err)}` };
}

function getByPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}
