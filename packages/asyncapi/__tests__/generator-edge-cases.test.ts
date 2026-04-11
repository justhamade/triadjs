/**
 * Phase 24 — behavior-coverage audit: AsyncAPI generator edge cases.
 */

import { describe, expect, it } from 'vitest';
import { channel, createRouter, t } from '@triad/core';
import { generateAsyncAPI, convertPath } from '../src/generator.js';

function minimalChannel(name: string, path = '/ws/x') {
  return channel({
    name,
    path,
    summary: `ch ${name}`,
    clientMessages: {
      ping: { schema: t.model(`${name}_Ping`, {}), description: 'ping' },
    },
    serverMessages: {
      pong: { schema: t.model(`${name}_Pong`, {}), description: 'pong' },
    },
    handlers: { ping: async () => {} },
  });
}

describe('generateAsyncAPI — router with no channels', () => {
  it('emits a valid 3.0.0 document with empty channels', () => {
    const r = createRouter({ title: 'Empty', version: '1.0.0' });
    const doc = generateAsyncAPI(r);
    expect(doc.asyncapi).toBe('3.0.0');
    expect(doc.channels).toEqual({});
    expect(doc.operations).toEqual({});
    expect(doc.components.schemas).toEqual({});
    expect(doc.components.messages).toEqual({});
  });

  it('omits tags when no contexts own channels', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const doc = generateAsyncAPI(r);
    expect(doc.tags).toBeUndefined();
  });
});

describe('generateAsyncAPI — multiple channels and operation ids', () => {
  it('emits one receive op per client message and one send op per server message', () => {
    const c = minimalChannel('roomA');
    const r = createRouter({ title: 'x', version: '1' });
    r.add(c);
    const doc = generateAsyncAPI(r);
    expect(doc.operations['roomA.client.ping']?.action).toBe('receive');
    expect(doc.operations['roomA.server.pong']?.action).toBe('send');
  });

  it('does not collide when two channels declare the same message type', () => {
    const c1 = minimalChannel('roomA');
    const c2 = minimalChannel('roomB');
    const r = createRouter({ title: 'x', version: '1' });
    r.add(c1, c2);
    const doc = generateAsyncAPI(r);
    expect(Object.keys(doc.operations).sort()).toEqual([
      'roomA.client.ping',
      'roomA.server.pong',
      'roomB.client.ping',
      'roomB.server.pong',
    ]);
  });
});

describe('generateAsyncAPI — bounded contexts', () => {
  it('emits a tag for contexts that own at least one channel', () => {
    const c = minimalChannel('chatCh');
    const r = createRouter({ title: 'x', version: '1' });
    r.context(
      'Chat',
      { description: 'real-time chat' },
      (ctx) => ctx.add(c),
    );
    const doc = generateAsyncAPI(r);
    expect(doc.tags).toEqual([{ name: 'Chat', description: 'real-time chat' }]);
  });

  it('does NOT emit a tag for contexts that only own HTTP endpoints', () => {
    const r = createRouter({ title: 'x', version: '1' });
    r.context('HttpOnly', { description: 'no ws here' }, () => {});
    const doc = generateAsyncAPI(r);
    expect(doc.tags).toBeUndefined();
  });
});

describe('convertPath — asyncapi', () => {
  it('converts :param to {param}', () => {
    expect(convertPath('/ws/rooms/:roomId')).toBe('/ws/rooms/{roomId}');
  });

  it('passes through paths with no params', () => {
    expect(convertPath('/ws/rooms')).toBe('/ws/rooms');
  });
});

describe('generateAsyncAPI — complex path params', () => {
  it('emits parameters for enum-typed path params with the values lifted', () => {
    const c = channel({
      name: 'tenantCh',
      path: '/ws/:tenant/room',
      summary: 's',
      connection: {
        params: {
          tenant: t.enum('us', 'eu', 'ap'),
        },
      },
      clientMessages: {
        hi: { schema: t.model('HiPayload', {}), description: 'hi' },
      },
      serverMessages: {
        bye: { schema: t.model('ByePayload', {}), description: 'bye' },
      },
      handlers: { hi: async () => {} },
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(c);
    const doc = generateAsyncAPI(r);
    const param = doc.channels['tenantCh']?.parameters?.['tenant'];
    expect(param?.enum).toEqual(['us', 'eu', 'ap']);
  });
});
