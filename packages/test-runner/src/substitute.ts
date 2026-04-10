/**
 * Placeholder substitution for `{name}` tokens in behavior request data.
 *
 * Fixtures come from two sources which are merged at run time:
 *   1. `behavior.given.fixtures` — inline values declared on the scenario
 *   2. The object returned by `behavior.given.setup(services)` — seed data
 *      created in the test database or in-memory store
 *
 * The substituted value is string-interpolation based: any occurrence of
 * `{key}` inside a string is replaced with `String(fixtures[key])`. Unknown
 * keys pass through untouched so genuine curly-brace literals (and template
 * parts the user forgot to fill in) are visible in error messages.
 *
 * Special case: if a string is **entirely** `{key}` and the fixture value is
 * not a string, the raw value is substituted instead of stringified. This
 * lets users write `.body({ count: '{limit}' })` with a numeric `limit`
 * fixture and get an actual number in the body.
 */

export type Fixtures = Record<string, unknown>;

const WHOLE_TOKEN_RE = /^\{(\w+)\}$/;
const ANY_TOKEN_RE = /\{(\w+)\}/g;

/** Recursively substitute `{key}` tokens in a value. Non-strings pass through. */
export function substitute<T>(value: T, fixtures: Fixtures): T {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return substituteString(value, fixtures) as T;
  }

  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, fixtures)) as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substitute(v, fixtures);
    }
    return out as T;
  }

  return value;
}

/** Substitute tokens inside a single string. See module docs for rules. */
export function substituteString(input: string, fixtures: Fixtures): unknown {
  // Whole-string match: preserve the fixture's native type.
  const whole = input.match(WHOLE_TOKEN_RE);
  if (whole) {
    const key = whole[1]!;
    if (key in fixtures) {
      return fixtures[key];
    }
    return input;
  }

  // Partial/mixed substitution: always produce a string.
  return input.replace(ANY_TOKEN_RE, (match, key: string) => {
    if (key in fixtures) {
      const value = fixtures[key];
      return value === undefined ? match : String(value);
    }
    return match;
  });
}
