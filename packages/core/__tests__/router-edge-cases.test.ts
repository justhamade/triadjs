/**
 * Phase 24 — behavior-coverage audit: router, endpoint, channel, and
 * ownership edge cases the existing test suite did not exercise.
 */

import { describe, expect, it } from 'vitest';
import { t } from '../src/schema/index.js';
import { endpoint } from '../src/endpoint.js';
import { channel } from '../src/channel.js';
import { createRouter, Router } from '../src/router.js';
import { checkOwnership } from '../src/ownership.js';
import { invokeBeforeHandler } from '../src/before-handler.js';
import { buildRespondMap, type ResponsesConfig } from '../src/context.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string(),
});

function makeEndpoint(name: string, path: string) {
  return endpoint({
    name,
    method: 'GET',
    path,
    summary: `test ${name}`,
    responses: { 200: { schema: Pet, description: 'ok' } },
    handler: async (ctx) =>
      ctx.respond[200]({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'x' }),
  });
}

function makeChannel(name: string, path: string) {
  return channel({
    name,
    path,
    summary: `chan ${name}`,
    clientMessages: {
      ping: { schema: t.model(`${name}Ping`, {}), description: 'ping' },
    },
    serverMessages: {
      pong: { schema: t.model(`${name}Pong`, {}), description: 'pong' },
    },
    handlers: { ping: async () => {} },
  });
}

describe('Router — edge cases', () => {
  it('allEndpoints() on an empty router returns an empty list', () => {
    const r = createRouter({ title: 'Empty', version: '1' });
    expect(r.allEndpoints()).toEqual([]);
    expect(r.allChannels()).toEqual([]);
  });

  it('allEndpoints() preserves declaration order across contexts', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const root = makeEndpoint('root', '/root');
    const a1 = makeEndpoint('a1', '/a1');
    const a2 = makeEndpoint('a2', '/a2');
    const b1 = makeEndpoint('b1', '/b1');

    r.add(root);
    r.context('A', {}, (c) => c.add(a1, a2));
    r.context('B', {}, (c) => c.add(b1));

    expect(r.allEndpoints().map((e) => e.name)).toEqual(['root', 'a1', 'a2', 'b1']);
  });

  it('add() accepts mixed channels and endpoints in any order', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const e1 = makeEndpoint('e1', '/e1');
    const c1 = makeChannel('c1', '/c1');
    const e2 = makeEndpoint('e2', '/e2');
    r.add(c1, e1, e2);
    expect(r.rootEndpoints.map((e) => e.name)).toEqual(['e1', 'e2']);
    expect(r.rootChannels.map((c) => c.name)).toEqual(['c1']);
  });

  it('findEndpoint() returns undefined for an empty router', () => {
    const r = createRouter({ title: 'x', version: '1' });
    expect(r.findEndpoint('nope')).toBeUndefined();
  });

  it('findChannel() returns undefined for an empty router', () => {
    const r = createRouter({ title: 'x', version: '1' });
    expect(r.findChannel('nope')).toBeUndefined();
  });

  it('isRouter() recognizes router instances created via createRouter', () => {
    const r = createRouter({ title: 'x', version: '1' });
    expect(Router.isRouter(r)).toBe(true);
  });

  it('isRouter() rejects plain objects and primitives', () => {
    expect(Router.isRouter({})).toBe(false);
    expect(Router.isRouter(null)).toBe(false);
    expect(Router.isRouter(undefined)).toBe(false);
    expect(Router.isRouter('router')).toBe(false);
    expect(Router.isRouter(42)).toBe(false);
  });

  it('allows the same endpoint instance to be referenced from a context', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const shared = makeEndpoint('shared', '/s');
    r.context('A', {}, (c) => c.add(shared));
    expect(r.contextOf(shared)?.name).toBe('A');
  });

  it('context() with no models defaults to an empty model list', () => {
    const r = createRouter({ title: 'x', version: '1' });
    r.context('NoModels', {}, () => {});
    expect(r.contexts[0]?.models).toEqual([]);
  });
});

describe('endpoint() — edge cases', () => {
  it('strips tag references so mutating the input does not mutate the endpoint', () => {
    const tags = ['A', 'B'];
    const ep = endpoint({
      name: 'e',
      method: 'GET',
      path: '/e',
      summary: 'e',
      tags,
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) =>
        ctx.respond[200]({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'x' }),
    });
    tags.push('C');
    expect(ep.tags).toEqual(['A', 'B']);
  });

  it('copies the behaviors array so the runtime endpoint is insulated', () => {
    const behaviors: [] = [];
    const ep = endpoint({
      name: 'e',
      method: 'GET',
      path: '/e',
      summary: 'e',
      behaviors,
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) =>
        ctx.respond[200]({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'x' }),
    });
    expect(ep.behaviors).not.toBe(behaviors);
  });

  it('accepts endpoints that declare only one response', () => {
    const ep = endpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      summary: 'p',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('pong'),
    });
    expect(Object.keys(ep.responses)).toEqual(['200']);
  });
});

describe('invokeBeforeHandler', () => {
  it('returns empty success state when no hook is provided', async () => {
    const responses: ResponsesConfig = {
      200: { schema: Pet, description: 'ok' },
    };
    const result = await invokeBeforeHandler(undefined, {
      rawHeaders: {},
      rawQuery: {},
      rawParams: {},
      rawCookies: {},
      services: {},
      respond: buildRespondMap(responses) as never,
    });
    expect(result).toEqual({ ok: true, state: {} });
  });
});

describe('channel() — edge cases', () => {
  it('defaults to auth strategy "header" when auth is omitted', () => {
    const c = makeChannel('c1', '/c1');
    expect(c.auth.strategy).toBe('header');
    expect(c.auth.firstMessageType).toBe('__auth');
    expect(c.auth.timeoutMs).toBe(5000);
  });

  it('preserves a custom auth strategy through normalization', () => {
    const c = channel({
      name: 'c',
      path: '/c',
      summary: 's',
      auth: { strategy: 'first-message', firstMessageType: 'login', timeoutMs: 2500 },
      clientMessages: {
        login: { schema: t.model('L', { token: t.string() }), description: 'login' },
      },
      serverMessages: {
        ok: { schema: t.model('O', {}), description: 'ok' },
      },
      handlers: { login: async () => {} },
    });
    expect(c.auth.strategy).toBe('first-message');
    expect(c.auth.firstMessageType).toBe('login');
    expect(c.auth.timeoutMs).toBe(2500);
  });

  it('validateBeforeConnect defaults to true', () => {
    const c = makeChannel('c1', '/c1');
    expect(c.connection.validateBeforeConnect).toBe(true);
  });

  it('copies tags so caller mutation does not bleed into runtime', () => {
    const tags = ['chat'];
    const c = channel({
      name: 'c',
      path: '/c',
      summary: 's',
      tags,
      clientMessages: {
        ping: { schema: t.model('P', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('Pg', {}), description: 'pg' },
      },
      handlers: { ping: async () => {} },
    });
    tags.push('other');
    expect(c.tags).toEqual(['chat']);
  });
});

describe('checkOwnership — edge cases with unusual shapes', () => {
  it('works with a frozen entity', () => {
    const entity = Object.freeze({ id: '1', ownerId: 'alice' });
    const r = checkOwnership(entity, 'alice', (e) => e.ownerId);
    expect(r.ok).toBe(true);
  });

  it('works with a class-instance entity', () => {
    class Project {
      constructor(public id: string, public ownerId: string) {}
    }
    const p = new Project('p1', 'alice');
    const r = checkOwnership(p, 'alice', (e) => e.ownerId);
    expect(r.ok).toBe(true);
  });

  it('distinguishes the owner-mismatch case when ids only differ in case', () => {
    const r = checkOwnership({ ownerId: 'Alice' }, 'alice', (e) => e.ownerId);
    expect(r).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('treats an empty string ownerId as a real value (not missing)', () => {
    const r = checkOwnership({ ownerId: '' }, '', (e) => e.ownerId);
    expect(r.ok).toBe(true);
  });

  it('does not collapse the not_found/forbidden distinction', () => {
    const notFound = checkOwnership<{ ownerId: string }>(null, 'alice', (e) => e.ownerId);
    const forbidden = checkOwnership({ ownerId: 'bob' }, 'alice', (e) => e.ownerId);
    expect(notFound.ok).toBe(false);
    expect(forbidden.ok).toBe(false);
    if (!notFound.ok && !forbidden.ok) {
      expect(notFound.reason).toBe('not_found');
      expect(forbidden.reason).toBe('forbidden');
    }
  });
});
