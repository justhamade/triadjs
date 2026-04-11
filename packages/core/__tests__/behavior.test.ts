import { describe, expect, it } from 'vitest';
import { scenario, parseAssertion, hasStatusAssertion } from '../src/behavior.js';

describe('parseAssertion', () => {
  it('parses status assertions', () => {
    const a = parseAssertion('response status is 201');
    expect(a).toMatchObject({ type: 'status', expected: 201 });
  });

  it('parses body matches Model assertions', () => {
    const a = parseAssertion('response body matches Pet');
    expect(a).toMatchObject({ type: 'body_matches', model: 'Pet' });
  });

  it('parses body has <field> <quoted-string>', () => {
    const a = parseAssertion('response body has name "Buddy"');
    expect(a).toMatchObject({ type: 'body_has', path: 'name', value: 'Buddy' });
  });

  it('parses body has <field> <number>', () => {
    const a = parseAssertion('response body has age 3');
    expect(a).toMatchObject({ type: 'body_has', path: 'age', value: 3 });
  });

  it('parses body has <field> true|false', () => {
    expect(parseAssertion('response body has active true')).toMatchObject({
      type: 'body_has',
      path: 'active',
      value: true,
    });
    expect(parseAssertion('response body has active false')).toMatchObject({
      type: 'body_has',
      path: 'active',
      value: false,
    });
  });

  it('parses body has <field> null as the null literal', () => {
    const a = parseAssertion('response body has token null');
    expect(a).toMatchObject({ type: 'body_has', path: 'token', value: null });
  });

  it('parses body has nextCursor null', () => {
    const a = parseAssertion('response body has nextCursor null');
    expect(a).toMatchObject({
      type: 'body_has',
      path: 'nextCursor',
      value: null,
    });
  });

  it('keeps quoted "null" as a string, not the null literal', () => {
    const a = parseAssertion('response body has name "null"');
    expect(a).toMatchObject({ type: 'body_has', path: 'name', value: 'null' });
    // Guard against accidental null coercion.
    expect((a as { value: unknown }).value).not.toBeNull();
    expect(typeof (a as { value: unknown }).value).toBe('string');
  });

  it('parses body has count null regardless of the field name', () => {
    const a = parseAssertion('response body has count null');
    expect(a).toMatchObject({ type: 'body_has', path: 'count', value: null });
  });

  it('parses the body_has_code idiom', () => {
    const a = parseAssertion('response body has code "NOT_FOUND"');
    expect(a).toMatchObject({ type: 'body_has_code', code: 'NOT_FOUND' });
  });

  it('parses body is an array', () => {
    expect(parseAssertion('response body is an array')).toMatchObject({
      type: 'body_is_array',
    });
  });

  it('parses body has length N', () => {
    expect(parseAssertion('response body has length 5')).toMatchObject({
      type: 'body_length',
      expected: 5,
    });
  });

  // -----------------------------------------------------------------------
  // Channel assertions (Phase 9.4)
  // -----------------------------------------------------------------------

  it('parses "all clients receive a <type> event"', () => {
    const a = parseAssertion('all clients receive a message event');
    expect(a).toMatchObject({
      type: 'channel_receives',
      client: '*',
      messageType: 'message',
    });
  });

  it('parses "<client> receives a <type> event"', () => {
    const a = parseAssertion('alice receives a message event');
    expect(a).toMatchObject({
      type: 'channel_receives',
      client: 'alice',
      messageType: 'message',
    });
  });

  it('parses "<client> does NOT receive a <type> event"', () => {
    const a = parseAssertion('bob does NOT receive a typing event');
    expect(a).toMatchObject({
      type: 'channel_not_receives',
      client: 'bob',
      messageType: 'typing',
    });
  });

  it('parses "<client> does not receive a <type> event" (lowercase)', () => {
    const a = parseAssertion('bob does not receive a typing event');
    expect(a).toMatchObject({
      type: 'channel_not_receives',
      client: 'bob',
      messageType: 'typing',
    });
  });

  it('parses "connection is rejected with code <N>"', () => {
    const a = parseAssertion('connection is rejected with code 401');
    expect(a).toMatchObject({ type: 'connection_rejected', code: 401 });
  });

  it('parses "<client> receives a <type> with <field> "<value>""', () => {
    const a = parseAssertion('alice receives a message with text "hello"');
    expect(a).toMatchObject({
      type: 'channel_message_has',
      client: 'alice',
      messageType: 'message',
      path: 'text',
      value: 'hello',
    });
  });

  it('parses "message has <field> "<value>""', () => {
    const a = parseAssertion('message has text "hi"');
    expect(a).toMatchObject({
      type: 'channel_message_has',
      client: '*',
      messageType: '*',
      path: 'text',
      value: 'hi',
    });
  });

  it('preserves raw on channel assertions', () => {
    const raws = [
      'alice receives a message event',
      'all clients receive a typing event',
      'connection is rejected with code 404',
      'message has text "hi"',
    ];
    for (const r of raws) expect(parseAssertion(r).raw).toBe(r);
  });

  it('falls back to custom for unrecognized forms', () => {
    const a = parseAssertion('some weird assertion');
    expect(a).toEqual({ type: 'custom', raw: 'some weird assertion' });
  });

  it('preserves the raw string on every assertion', () => {
    const raws = [
      'response status is 200',
      'response body matches User',
      'response body has name "X"',
      'something custom',
    ];
    for (const r of raws) {
      expect(parseAssertion(r).raw).toBe(r);
    }
  });
});

describe('scenario builder', () => {
  it('builds a complete behavior through given/when/then', () => {
    const b = scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201');

    expect(b.scenario).toBe('Pets can be created with valid data');
    expect(b.given.description).toBe('a valid pet payload');
    expect(b.given.body).toEqual({ name: 'Buddy', species: 'dog', age: 3 });
    expect(b.when.description).toBe('I create a pet');
    expect(b.then).toHaveLength(1);
    expect(b.then[0]).toMatchObject({ type: 'status', expected: 201 });
  });

  it('chains multiple .and() assertions after .then()', () => {
    const b = scenario('Multiple assertions')
      .given('some state')
      .when('action')
      .then('response status is 200')
      .and('response body matches Pet')
      .and('response body has name "Buddy"');

    expect(b.then).toHaveLength(3);
    expect(b.then[0]?.type).toBe('status');
    expect(b.then[1]?.type).toBe('body_matches');
    expect(b.then[2]?.type).toBe('body_has');
  });

  it('captures params/query/headers from the given stage', () => {
    const b = scenario('Full request shape')
      .given('a request')
      .params({ id: '42' })
      .query({ limit: 10 })
      .headers({ authorization: 'Bearer token' })
      .when('I call the endpoint')
      .then('response status is 200');

    expect(b.given.params).toEqual({ id: '42' });
    expect(b.given.query).toEqual({ limit: 10 });
    expect(b.given.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('carries a setup function for async seed data', () => {
    const setupFn = async () => ({ petId: 'abc-123' });
    const b = scenario('With setup')
      .given('a seeded pet')
      .setup(setupFn)
      .when('I fetch the pet')
      .then('response status is 200');

    expect(b.given.setup).toBe(setupFn);
  });

  it('carries inline fixtures', () => {
    const b = scenario('With fixtures')
      .given('an absent pet')
      .fixtures({ petId: '00000000-0000-0000-0000-000000000000' })
      .when('I fetch the pet')
      .then('response status is 404');

    expect(b.given.fixtures).toEqual({
      petId: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('merges repeated params/query/headers calls', () => {
    const b = scenario('Merged request parts')
      .given('a request')
      .params({ a: 1 })
      .params({ b: 2 })
      .query({ x: 'first' })
      .query({ y: 'second' })
      .when('I call')
      .then('response status is 200');

    expect(b.given.params).toEqual({ a: 1, b: 2 });
    expect(b.given.query).toEqual({ x: 'first', y: 'second' });
  });

  it('each scenario produces an independent behavior', () => {
    const a = scenario('First').given('a').when('b').then('response status is 200');
    const b = scenario('Second').given('a').when('b').then('response status is 404');
    expect(a).not.toBe(b);
    expect(a.scenario).toBe('First');
    expect(b.scenario).toBe('Second');
  });
});

describe('hasStatusAssertion helper', () => {
  it('extracts the status code when present', () => {
    const b = scenario('s').given('g').when('w').then('response status is 201');
    expect(hasStatusAssertion(b)).toBe(201);
  });

  it('returns undefined when no status assertion exists', () => {
    const b = scenario('s').given('g').when('w').then('response body matches Pet');
    expect(hasStatusAssertion(b)).toBeUndefined();
  });
});
