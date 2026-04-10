/**
 * The `scenario / given / when / then / and` behavior builder.
 *
 * A behavior is a single Given/When/Then test case attached to an endpoint.
 * It serves three purposes:
 *
 *   1. Human documentation (becomes a Gherkin `Scenario:` line)
 *   2. Test-runner input (Phase 5 executes each behavior against the endpoint)
 *   3. AI-legible business context (the scenario name explains WHY a test exists)
 *
 * The builder is the only fluent API in Triad — BDD reads like a sentence, so
 * the chain preserves that shape:
 *
 * ```ts
 * scenario('Pet names must be unique within the same species')
 *   .given('a pet already exists with name "Buddy" as a dog')
 *   .body({ name: 'Buddy', species: 'dog', age: 5 })
 *   .when('I create a pet')
 *   .then('response status is 409')
 *   .and('response body has code "DUPLICATE"')
 * ```
 */

import type { ServiceContainer } from './context.js';

// ---------------------------------------------------------------------------
// Data structure
// ---------------------------------------------------------------------------

export interface GivenData {
  description: string;
  body?: unknown;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  setup?: (services: ServiceContainer) => Promise<Record<string, unknown> | void>;
  fixtures?: Record<string, unknown>;
}

export interface WhenData {
  description: string;
}

/**
 * A single `then` step. Triad attempts to parse common response-assertion
 * patterns into structured variants; anything unrecognized is preserved as
 * `{ type: 'custom', raw }` so the runner (or AI) can still make sense of it.
 */
export type Assertion =
  | { type: 'status'; expected: number; raw: string }
  | { type: 'body_matches'; model: string; raw: string }
  | { type: 'body_has'; path: string; value: unknown; raw: string }
  | { type: 'body_is_array'; raw: string }
  | { type: 'body_length'; expected: number; raw: string }
  | { type: 'body_has_code'; code: string; raw: string }
  // --- Channel assertions (Phase 9.4) -------------------------------------
  // `client` is either a named client id (e.g. `"alice"`) or `"*"` for
  // "any client" / "all clients" depending on the variant.
  | {
      type: 'channel_receives';
      client: string;
      messageType: string;
      raw: string;
    }
  | {
      type: 'channel_not_receives';
      client: string;
      messageType: string;
      raw: string;
    }
  | { type: 'connection_rejected'; code: number; raw: string }
  | {
      type: 'channel_message_has';
      client: string;
      messageType: string;
      path: string;
      value: unknown;
      raw: string;
    }
  | { type: 'custom'; raw: string };

export interface Behavior {
  scenario: string;
  given: GivenData;
  when: WhenData;
  then: Assertion[];
}

/**
 * The object returned from `.then(...)`. It IS a Behavior (all fields are
 * present and readable) but it also carries a chainable `.and()` for adding
 * further assertions.
 */
export interface ChainableBehavior extends Behavior {
  and(description: string): ChainableBehavior;
}

// ---------------------------------------------------------------------------
// Assertion parser
// ---------------------------------------------------------------------------

/**
 * Parse a `then` step description into a structured assertion. Unrecognized
 * forms fall through to `{ type: 'custom' }` — the runner can still execute
 * them via custom matchers.
 */
export function parseAssertion(raw: string): Assertion {
  const text = raw.trim();

  // "response status is 201"
  const status = text.match(/^response status is (\d+)$/);
  if (status) return { type: 'status', expected: Number(status[1]), raw };

  // "response body matches ModelName"
  const matches = text.match(/^response body matches (\w+)$/);
  if (matches) return { type: 'body_matches', model: matches[1]!, raw };

  // "response body is an array"
  if (text === 'response body is an array') {
    return { type: 'body_is_array', raw };
  }

  // "response body has length 5"
  const length = text.match(/^response body has length (\d+)$/);
  if (length) return { type: 'body_length', expected: Number(length[1]), raw };

  // "response body has code "NOT_FOUND""  (common idiom, map to body_has on 'code')
  const codeQuoted = text.match(/^response body has code "([^"]+)"$/);
  if (codeQuoted) return { type: 'body_has_code', code: codeQuoted[1]!, raw };

  // "response body has <path> "value""   (quoted string value)
  const hasStr = text.match(/^response body has (\S+) "([^"]*)"$/);
  if (hasStr) {
    return { type: 'body_has', path: hasStr[1]!, value: hasStr[2], raw };
  }

  // "response body has <path> <number>"
  const hasNum = text.match(/^response body has (\S+) (-?\d+(?:\.\d+)?)$/);
  if (hasNum) {
    return { type: 'body_has', path: hasNum[1]!, value: Number(hasNum[2]), raw };
  }

  // "response body has <path> true|false"
  const hasBool = text.match(/^response body has (\S+) (true|false)$/);
  if (hasBool) {
    return { type: 'body_has', path: hasBool[1]!, value: hasBool[2] === 'true', raw };
  }

  // -------------------------------------------------------------------
  // Channel assertions (Phase 9.4)
  // -------------------------------------------------------------------

  // "all clients receive a <messageType> event"
  const allReceive = text.match(
    /^all clients receive (?:a|an) (\w+) event$/,
  );
  if (allReceive) {
    return {
      type: 'channel_receives',
      client: '*',
      messageType: allReceive[1]!,
      raw,
    };
  }

  // "<client> does NOT receive a <messageType> event"
  // Case-insensitive NOT so users can write "not" or "NOT".
  const notReceive = text.match(
    /^(\w+) does (?:not|NOT) receive (?:a|an) (\w+) event$/,
  );
  if (notReceive) {
    return {
      type: 'channel_not_receives',
      client: notReceive[1]!,
      messageType: notReceive[2]!,
      raw,
    };
  }

  // "<client> receives a <messageType> with <field> "<value>""
  // Checked BEFORE the simpler "<client> receives a <messageType> event"
  // form so the longer pattern wins.
  const receivesWith = text.match(
    /^(\w+) receives (?:a|an) (\w+) with (\S+) "([^"]*)"$/,
  );
  if (receivesWith) {
    return {
      type: 'channel_message_has',
      client: receivesWith[1]!,
      messageType: receivesWith[2]!,
      path: receivesWith[3]!,
      value: receivesWith[4],
      raw,
    };
  }

  // "<client> receives a <messageType> event"
  const clientReceives = text.match(
    /^(\w+) receives (?:a|an) (\w+) event$/,
  );
  if (clientReceives) {
    return {
      type: 'channel_receives',
      client: clientReceives[1]!,
      messageType: clientReceives[2]!,
      raw,
    };
  }

  // "connection is rejected with code <N>"
  const rejected = text.match(/^connection is rejected with code (\d+)$/);
  if (rejected) {
    return {
      type: 'connection_rejected',
      code: Number(rejected[1]),
      raw,
    };
  }

  // "message has <field> "<value>"" — client `*` means "any client", and
  // messageType `*` means "any message type" (the runner picks the most
  // recent message received by the default client and checks the field).
  const msgHas = text.match(/^message has (\S+) "([^"]*)"$/);
  if (msgHas) {
    return {
      type: 'channel_message_has',
      client: '*',
      messageType: '*',
      path: msgHas[1]!,
      value: msgHas[2],
      raw,
    };
  }

  return { type: 'custom', raw };
}

// ---------------------------------------------------------------------------
// Builder stages
// ---------------------------------------------------------------------------

class GivenBuilder {
  private readonly data: GivenData;

  constructor(
    private readonly scenarioName: string,
    description: string,
  ) {
    this.data = { description };
  }

  body(data: unknown): this {
    this.data.body = data;
    return this;
  }

  params(data: Record<string, unknown>): this {
    this.data.params = { ...(this.data.params ?? {}), ...data };
    return this;
  }

  query(data: Record<string, unknown>): this {
    this.data.query = { ...(this.data.query ?? {}), ...data };
    return this;
  }

  headers(data: Record<string, unknown>): this {
    this.data.headers = { ...(this.data.headers ?? {}), ...data };
    return this;
  }

  /**
   * Provide an async setup function that seeds test data. The returned object
   * is merged into `fixtures` so later `then` assertions can reference keys
   * like `{petId}` in string templates.
   */
  setup(
    fn: (services: ServiceContainer) => Promise<Record<string, unknown> | void>,
  ): this {
    this.data.setup = fn;
    return this;
  }

  /** Inline fixture values (used when setup isn't needed). */
  fixtures(data: Record<string, unknown>): this {
    this.data.fixtures = { ...(this.data.fixtures ?? {}), ...data };
    return this;
  }

  when(description: string): WhenBuilder {
    return new WhenBuilder(this.scenarioName, this.data, description);
  }
}

class WhenBuilder {
  constructor(
    private readonly scenarioName: string,
    private readonly given: GivenData,
    private readonly description: string,
  ) {}

  then(description: string): ChainableBehavior {
    const behavior: Behavior = {
      scenario: this.scenarioName,
      given: this.given,
      when: { description: this.description },
      then: [parseAssertion(description)],
    };
    return toChainable(behavior);
  }
}

function toChainable(behavior: Behavior): ChainableBehavior {
  // Mutate in place so `.and()` and the underlying data stay consistent
  // regardless of which reference the caller holds.
  const chainable = behavior as ChainableBehavior;
  chainable.and = function (description: string) {
    this.then.push(parseAssertion(description));
    return this;
  };
  return chainable;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ScenarioStage {
  given(description: string): GivenBuilder;
}

/**
 * Begin a behavior scenario. The returned object only offers `.given(...)`
 * so the API enforces the BDD ordering.
 */
export function scenario(name: string): ScenarioStage {
  return {
    given(description: string) {
      return new GivenBuilder(name, description);
    },
  };
}

/** Type guard for behaviors with a parsed status assertion. */
export function hasStatusAssertion(b: Behavior): number | undefined {
  const first = b.then.find((a) => a.type === 'status');
  return first?.type === 'status' ? first.expected : undefined;
}
