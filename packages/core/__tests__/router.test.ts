import { describe, expect, it } from 'vitest';
import { t } from '../src/schema/index.js';
import { endpoint } from '../src/endpoint.js';
import { channel } from '../src/channel.js';
import { createRouter } from '../src/router.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string(),
});

const Inventory = t.model('Inventory', {
  sku: t.string(),
  count: t.int32().min(0),
});

function makeEndpoint(name: string, path: string) {
  return endpoint({
    name,
    method: 'GET',
    path,
    summary: `test ${name}`,
    responses: { 200: { schema: Pet, description: 'ok' } },
    handler: async (ctx) => ctx.respond[200]({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'test',
    }),
  });
}

describe('Router — basic registration', () => {
  it('stores config', () => {
    const r = createRouter({
      title: 'Petstore API',
      version: '1.0.0',
      description: 'Sample',
      servers: [{ url: 'https://api.example.com', description: 'prod' }],
    });
    expect(r.config.title).toBe('Petstore API');
    expect(r.config.version).toBe('1.0.0');
    expect(r.config.servers).toHaveLength(1);
  });

  it('add() registers endpoints on the root', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const e1 = makeEndpoint('a', '/a');
    const e2 = makeEndpoint('b', '/b');
    r.add(e1, e2);
    expect(r.rootEndpoints).toHaveLength(2);
    expect(r.rootEndpoints).toContain(e1);
  });

  it('add() returns this for chaining', () => {
    const r = createRouter({ title: 'x', version: '1' });
    expect(r.add(makeEndpoint('a', '/a'))).toBe(r);
  });
});

describe('Router — bounded contexts', () => {
  it('context() groups endpoints under a named context', () => {
    const r = createRouter({ title: 'Petstore', version: '1' });
    const createPet = makeEndpoint('createPet', '/pets');
    const getPet = makeEndpoint('getPet', '/pets/:id');

    r.context(
      'Adoption',
      {
        description: 'Adoption lifecycle',
        models: [Pet],
      },
      (ctx) => {
        ctx.add(createPet, getPet);
      },
    );

    expect(r.contexts).toHaveLength(1);
    expect(r.contexts[0]?.name).toBe('Adoption');
    expect(r.contexts[0]?.description).toBe('Adoption lifecycle');
    expect(r.contexts[0]?.models).toContain(Pet);
    expect(r.contexts[0]?.endpoints).toEqual([createPet, getPet]);
  });

  it('supports multiple contexts', () => {
    const r = createRouter({ title: 'Petstore', version: '1' });
    r.context('Adoption', { models: [Pet] }, (ctx) => {
      ctx.add(makeEndpoint('createPet', '/pets'));
    });
    r.context('Inventory', { models: [Inventory] }, (ctx) => {
      ctx.add(makeEndpoint('listInventory', '/inventory'));
    });
    expect(r.contexts).toHaveLength(2);
    expect(r.contexts[0]?.name).toBe('Adoption');
    expect(r.contexts[1]?.name).toBe('Inventory');
  });

  it('allEndpoints() flattens root + all contexts', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const root = makeEndpoint('root', '/root');
    const a1 = makeEndpoint('a1', '/a1');
    const b1 = makeEndpoint('b1', '/b1');

    r.add(root);
    r.context('A', {}, (ctx) => ctx.add(a1));
    r.context('B', {}, (ctx) => ctx.add(b1));

    expect(r.allEndpoints()).toEqual([root, a1, b1]);
  });

  it('findEndpoint() searches across root and contexts', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const e = makeEndpoint('target', '/t');
    r.context('Ctx', {}, (ctx) => ctx.add(e));
    expect(r.findEndpoint('target')).toBe(e);
    expect(r.findEndpoint('missing')).toBeUndefined();
  });

  it('contextOf() returns the bounded context containing an endpoint', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const rootEp = makeEndpoint('rootEp', '/r');
    const ctxEp = makeEndpoint('ctxEp', '/c');
    r.add(rootEp);
    r.context('Ctx', {}, (ctx) => ctx.add(ctxEp));

    expect(r.contextOf(ctxEp)?.name).toBe('Ctx');
    expect(r.contextOf(rootEp)).toBeUndefined();
  });

  it('chaining add() inside a context returns the ContextBuilder', () => {
    const r = createRouter({ title: 'x', version: '1' });
    r.context('Chained', {}, (ctx) => {
      ctx
        .add(makeEndpoint('e1', '/e1'))
        .add(makeEndpoint('e2', '/e2'))
        .add(makeEndpoint('e3', '/e3'));
    });
    expect(r.contexts[0]?.endpoints).toHaveLength(3);
  });

  it('context() returns the router for chaining', () => {
    const r = createRouter({ title: 'x', version: '1' });
    expect(r.context('A', {}, () => {})).toBe(r);
  });
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

function makeChannel(name: string, path: string) {
  return channel({
    name,
    path,
    summary: `channel ${name}`,
    clientMessages: {
      ping: { schema: t.model(`${name}Ping`, {}), description: 'ping' },
    },
    serverMessages: {
      pong: { schema: t.model(`${name}Pong`, {}), description: 'pong' },
    },
    handlers: { ping: async () => {} },
  });
}

describe('Router — channels', () => {
  it('add() routes channels into rootChannels, endpoints into rootEndpoints', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const ep = makeEndpoint('httpRoute', '/http');
    const ch = makeChannel('wsRoute', '/ws');
    r.add(ep, ch);
    expect(r.rootEndpoints).toEqual([ep]);
    expect(r.rootChannels).toEqual([ch]);
  });

  it('allChannels() flattens root + context channels in declaration order', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const rootCh = makeChannel('rootCh', '/root');
    const ctxCh = makeChannel('ctxCh', '/ctx');
    r.add(rootCh);
    r.context('Ctx', {}, (ctx) => ctx.add(ctxCh));
    expect(r.allChannels()).toEqual([rootCh, ctxCh]);
  });

  it('allEndpoints() is unchanged when only channels are added', () => {
    const r = createRouter({ title: 'x', version: '1' });
    r.add(makeChannel('ws1', '/ws1'), makeChannel('ws2', '/ws2'));
    expect(r.allEndpoints()).toEqual([]);
    expect(r.allChannels()).toHaveLength(2);
  });

  it('bounded contexts can hold both endpoints and channels', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const httpEp = makeEndpoint('httpEp', '/http');
    const wsCh = makeChannel('wsCh', '/ws');
    r.context('Mixed', {}, (ctx) => {
      ctx.add(httpEp, wsCh);
    });
    expect(r.contexts[0]?.endpoints).toEqual([httpEp]);
    expect(r.contexts[0]?.channels).toEqual([wsCh]);
  });

  it('findChannel() locates channels by name across root + contexts', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const rootCh = makeChannel('findMe', '/root');
    const ctxCh = makeChannel('alsoMe', '/ctx');
    r.add(rootCh);
    r.context('Ctx', {}, (ctx) => ctx.add(ctxCh));
    expect(r.findChannel('findMe')).toBe(rootCh);
    expect(r.findChannel('alsoMe')).toBe(ctxCh);
    expect(r.findChannel('missing')).toBeUndefined();
  });

  it('contextOf() accepts either an endpoint or a channel', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const ep = makeEndpoint('ep1', '/e1');
    const ch = makeChannel('ch1', '/c1');
    r.context('Chat', {}, (ctx) => ctx.add(ep, ch));
    expect(r.contextOf(ep)?.name).toBe('Chat');
    expect(r.contextOf(ch)?.name).toBe('Chat');
  });

  it('contextOf() returns undefined for items registered on the root', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const ch = makeChannel('rootOnly', '/root');
    r.add(ch);
    expect(r.contextOf(ch)).toBeUndefined();
  });
});
