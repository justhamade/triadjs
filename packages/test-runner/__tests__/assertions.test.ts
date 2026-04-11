import { describe, expect, it } from 'vitest';
import { t } from '@triad/core';
import type { Assertion, HandlerResponse } from '@triad/core';
import {
  runSingleAssertion,
  getByPath,
  type AssertionRunOptions,
} from '../src/assertions.js';
import { AssertionFailure } from '../src/results.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat'),
});

const models = new Map([['Pet', Pet]]);
const baseOpts: AssertionRunOptions = { models, fixtures: {} };

function res(status: number, body: unknown): HandlerResponse {
  return { status, body };
}

async function expectFailure(
  promise: Promise<void>,
  messageIncludes?: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AssertionFailure);
  if (messageIncludes) {
    await expect(promise).rejects.toThrow(messageIncludes);
  }
}

describe('getByPath', () => {
  it('reads a top-level field', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1);
  });

  it('reads a nested field via dot notation', () => {
    expect(getByPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing paths', () => {
    expect(getByPath({ a: 1 }, 'b')).toBeUndefined();
    expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('handles null/undefined input', () => {
    expect(getByPath(null, 'a')).toBeUndefined();
    expect(getByPath(undefined, 'a')).toBeUndefined();
  });
});

describe('runSingleAssertion — status', () => {
  const a: Assertion = { type: 'status', expected: 201, raw: 'response status is 201' };

  it('passes when the status matches', async () => {
    await expect(runSingleAssertion(res(201, {}), a, baseOpts)).resolves.toBeUndefined();
  });

  it('fails when the status differs', async () => {
    await expectFailure(
      runSingleAssertion(res(500, {}), a, baseOpts),
      'Expected response status 201, got 500',
    );
  });
});

describe('runSingleAssertion — body_matches', () => {
  const a: Assertion = {
    type: 'body_matches',
    model: 'Pet',
    raw: 'response body matches Pet',
  };

  it('passes when the body validates against the model', async () => {
    const body = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Buddy',
      species: 'dog',
    };
    await expect(runSingleAssertion(res(200, body), a, baseOpts)).resolves.toBeUndefined();
  });

  it('fails when the body does not validate', async () => {
    const body = { id: 'not-a-uuid', name: 'Buddy', species: 'dragon' };
    await expectFailure(
      runSingleAssertion(res(200, body), a, baseOpts),
      'does not match model "Pet"',
    );
  });

  it('fails when the model is unknown', async () => {
    const unknownModel: Assertion = {
      type: 'body_matches',
      model: 'Unicorn',
      raw: 'response body matches Unicorn',
    };
    await expectFailure(
      runSingleAssertion(res(200, {}), unknownModel, baseOpts),
      'Unknown model "Unicorn"',
    );
  });
});

describe('runSingleAssertion — body_has', () => {
  const a: Assertion = {
    type: 'body_has',
    path: 'name',
    value: 'Buddy',
    raw: 'response body has name "Buddy"',
  };

  it('passes on equal values', async () => {
    await expect(
      runSingleAssertion(res(200, { name: 'Buddy' }), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('fails on unequal values', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { name: 'Whiskers' }), a, baseOpts),
      'response body.name',
    );
  });

  it('substitutes fixtures in the expected value', async () => {
    const a2: Assertion = {
      type: 'body_has',
      path: 'id',
      value: '{petId}',
      raw: 'response body has id "{petId}"',
    };
    await expect(
      runSingleAssertion(res(200, { id: 'abc-123' }), a2, {
        models,
        fixtures: { petId: 'abc-123' },
      }),
    ).resolves.toBeUndefined();
  });

  it('reads nested paths', async () => {
    const a2: Assertion = {
      type: 'body_has',
      path: 'owner.name',
      value: 'Alice',
      raw: 'response body has owner.name "Alice"',
    };
    await expect(
      runSingleAssertion(res(200, { owner: { name: 'Alice' } }), a2, baseOpts),
    ).resolves.toBeUndefined();
  });
});

describe('runSingleAssertion — body_has with null literal', () => {
  const a: Assertion = {
    type: 'body_has',
    path: 'token',
    value: null,
    raw: 'response body has token null',
  };

  it('passes when the field value is exactly null', async () => {
    await expect(
      runSingleAssertion(res(200, { token: null }), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('fails when the field has a non-null string value', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { token: 'abc' }), a, baseOpts),
      'response body.token',
    );
  });

  // Strict null semantics: an absent field (undefined) is NOT the same as
  // an explicit null. Users asserting `null` are asking "the key exists and
  // its value is null" — not "the key is missing". The evaluator uses strict
  // equality so `undefined !== null` and this assertion fails.
  it('fails when the field is undefined (undefined !== null)', async () => {
    await expectFailure(
      runSingleAssertion(res(200, {}), a, baseOpts),
      'response body.token',
    );
  });

  it('fails when the field is 0 (0 !== null)', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { token: 0 }), a, baseOpts),
      'response body.token',
    );
  });

  it('fails when the field is false (false !== null)', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { token: false }), a, baseOpts),
      'response body.token',
    );
  });

  it('fails when the field is the string "null" (type mismatch)', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { token: 'null' }), a, baseOpts),
      'response body.token',
    );
  });
});

describe('runSingleAssertion — body_has_code', () => {
  const a: Assertion = {
    type: 'body_has_code',
    code: 'NOT_FOUND',
    raw: 'response body has code "NOT_FOUND"',
  };

  it('passes when the code matches', async () => {
    await expect(
      runSingleAssertion(res(404, { code: 'NOT_FOUND' }), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('fails when the code differs', async () => {
    await expectFailure(
      runSingleAssertion(res(404, { code: 'OTHER' }), a, baseOpts),
      'response body.code',
    );
  });
});

describe('runSingleAssertion — body_is_array and body_length', () => {
  it('body_is_array passes for arrays', async () => {
    const a: Assertion = { type: 'body_is_array', raw: 'response body is an array' };
    await expect(runSingleAssertion(res(200, []), a, baseOpts)).resolves.toBeUndefined();
  });

  it('body_is_array fails for non-arrays', async () => {
    const a: Assertion = { type: 'body_is_array', raw: 'response body is an array' };
    await expectFailure(runSingleAssertion(res(200, {}), a, baseOpts));
  });

  it('body_length passes for matching length', async () => {
    const a: Assertion = {
      type: 'body_length',
      expected: 2,
      raw: 'response body has length 2',
    };
    await expect(
      runSingleAssertion(res(200, [1, 2]), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('body_length fails for wrong length', async () => {
    const a: Assertion = {
      type: 'body_length',
      expected: 2,
      raw: 'response body has length 2',
    };
    await expectFailure(
      runSingleAssertion(res(200, [1]), a, baseOpts),
      'length 2',
    );
  });
});

describe('runSingleAssertion — custom FAILS by default', () => {
  const a: Assertion = { type: 'custom', raw: 'something weird' };

  it('fails with a helpful message', async () => {
    await expectFailure(
      runSingleAssertion(res(200, {}), a, baseOpts),
      'Unrecognized assertion',
    );
  });

  it('passes when a custom matcher is registered for the raw text', async () => {
    await expect(
      runSingleAssertion(res(200, {}), a, {
        ...baseOpts,
        customMatchers: {
          'something weird': () => {
            // matcher passes by not throwing
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('custom matchers can throw to fail the assertion', async () => {
    await expect(
      runSingleAssertion(res(200, {}), a, {
        ...baseOpts,
        customMatchers: {
          'something weird': () => {
            throw new Error('custom matcher failed');
          },
        },
      }),
    ).rejects.toThrow('custom matcher failed');
  });
});

describe('runSingleAssertion — body_is_empty', () => {
  const a: Assertion = {
    type: 'body_is_empty',
    raw: 'response body is empty',
  };

  it('passes when body is undefined (typical 204 case)', async () => {
    await expect(
      runSingleAssertion(res(204, undefined), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('passes when body is null', async () => {
    await expect(
      runSingleAssertion(res(204, null), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('passes when body is an empty string', async () => {
    await expect(
      runSingleAssertion(res(204, ''), a, baseOpts),
    ).resolves.toBeUndefined();
  });

  it('fails when body is an empty object (not considered empty)', async () => {
    await expectFailure(
      runSingleAssertion(res(200, {}), a, baseOpts),
      'Expected response body to be empty',
    );
  });

  it('fails when body is a non-empty object', async () => {
    await expectFailure(
      runSingleAssertion(res(200, { id: '1' }), a, baseOpts),
      'Expected response body to be empty',
    );
  });

  it('fails when body is a non-empty string', async () => {
    await expectFailure(
      runSingleAssertion(res(200, 'oops'), a, baseOpts),
      'Expected response body to be empty',
    );
  });
});
