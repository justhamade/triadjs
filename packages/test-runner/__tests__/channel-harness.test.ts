import { describe, expect, it } from 'vitest';
import { channel, t, ValidationException } from '@triadjs/core';
import { ChannelHarness } from '../src/channel-harness.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ChatMessage = t.model('ChatMessage', {
  from: t.string(),
  text: t.string(),
});

function makeRoomChannel() {
  return channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Chat room',
    connection: { params: { roomId: t.string() } },
    clientMessages: {
      sendMessage: { schema: ChatMessage, description: 'Send' },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'Broadcast' },
      typing: { schema: t.model('Typing', { user: t.string() }), description: 'Typing' },
    },
    onConnect: (ctx) => {
      ctx.state.user = 'anon';
    },
    handlers: {
      sendMessage: (ctx, data) => {
        ctx.broadcast.message(data);
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelHarness — connect', () => {
  it('calls onConnect and sets state on the client', async () => {
    const harness = new ChannelHarness(makeRoomChannel(), {});
    const client = await harness.connect('alice', { params: { roomId: 'r1' } });
    expect(client.rejected).toBe(false);
    expect(client.state.user).toBe('anon');
  });

  it('marks client rejected with 4400 when params are invalid', async () => {
    const harness = new ChannelHarness(makeRoomChannel(), {});
    // Missing roomId — should fail validation
    const client = await harness.connect('alice', { params: {} });
    expect(client.rejected).toBe(true);
    expect(client.rejectedCode).toBe(4400);
    expect(harness.getClient('alice')).toBeUndefined();
  });

  it('captures ctx.reject(code, message) with the given code', async () => {
    const ch = channel({
      name: 'gated',
      path: '/ws/gated',
      summary: 'g',
      clientMessages: { ping: { schema: t.model('Ping', {}), description: 'p' } },
      serverMessages: { pong: { schema: t.model('Pong', {}), description: 'p' } },
      onConnect: (ctx) => ctx.reject(401, 'nope'),
      handlers: { ping: () => {} },
    });
    const harness = new ChannelHarness(ch, {});
    const client = await harness.connect('alice', {});
    expect(client.rejected).toBe(true);
    expect(client.rejectedCode).toBe(401);
    expect(client.rejectedMessage).toBe('nope');
    expect(harness.getClient('alice')).toBeUndefined();
  });
});

describe('ChannelHarness — grouping', () => {
  it('groups clients by resolved params', async () => {
    const harness = new ChannelHarness(makeRoomChannel(), {});
    const alice = await harness.connect('alice', { params: { roomId: 'r1' } });
    const bob = await harness.connect('bob', { params: { roomId: 'r1' } });
    const carol = await harness.connect('carol', { params: { roomId: 'r2' } });

    await harness.send('alice', 'sendMessage', { from: 'alice', text: 'hi' });

    expect(alice.receivedOf('message')).toHaveLength(1);
    expect(bob.receivedOf('message')).toHaveLength(1);
    expect(carol.receivedOf('message')).toHaveLength(0);
  });
});

describe('ChannelHarness — outgoing scopes', () => {
  it('broadcast delivers to every client in the group including the sender', async () => {
    const harness = new ChannelHarness(makeRoomChannel(), {});
    const alice = await harness.connect('alice', { params: { roomId: 'r1' } });
    const bob = await harness.connect('bob', { params: { roomId: 'r1' } });
    await harness.send('alice', 'sendMessage', { from: 'alice', text: 'hello' });
    expect(alice.received).toHaveLength(1);
    expect(bob.received).toHaveLength(1);
  });

  it('broadcastOthers excludes the sender', async () => {
    const ch = channel({
      name: 'typingCh',
      path: '/ws/rooms/:roomId',
      summary: 't',
      connection: { params: { roomId: t.string() } },
      clientMessages: {
        startTyping: {
          schema: t.model('StartTyping', { user: t.string() }),
          description: 's',
        },
      },
      serverMessages: {
        typing: { schema: t.model('Typing', { user: t.string() }), description: 't' },
      },
      handlers: {
        startTyping: (ctx, data) => {
          ctx.broadcastOthers.typing(data);
        },
      },
    });
    const harness = new ChannelHarness(ch, {});
    const alice = await harness.connect('alice', { params: { roomId: 'r1' } });
    const bob = await harness.connect('bob', { params: { roomId: 'r1' } });
    await harness.send('alice', 'startTyping', { user: 'alice' });
    expect(alice.receivedOf('typing')).toHaveLength(0);
    expect(bob.receivedOf('typing')).toHaveLength(1);
  });

  it('send delivers only to the sender', async () => {
    const ch = channel({
      name: 'privAck',
      path: '/ws/rooms/:roomId',
      summary: 'p',
      connection: { params: { roomId: t.string() } },
      clientMessages: {
        ping: { schema: t.model('Ping2', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('Pong2', {}), description: 'p' },
      },
      handlers: {
        ping: (ctx) => {
          ctx.send.pong({});
        },
      },
    });
    const harness = new ChannelHarness(ch, {});
    const alice = await harness.connect('alice', { params: { roomId: 'r1' } });
    const bob = await harness.connect('bob', { params: { roomId: 'r1' } });
    await harness.send('alice', 'ping', {});
    expect(alice.receivedOf('pong')).toHaveLength(1);
    expect(bob.receivedOf('pong')).toHaveLength(0);
  });
});

describe('ChannelHarness — outgoing validation', () => {
  it('throws ValidationException when a handler broadcasts an invalid shape', async () => {
    const ch = channel({
      name: 'bad',
      path: '/ws/bad',
      summary: 'b',
      clientMessages: {
        trigger: { schema: t.model('Trigger', {}), description: 't' },
      },
      serverMessages: {
        message: { schema: ChatMessage, description: 'm' },
      },
      handlers: {
        trigger: (ctx) => {
          // @ts-expect-error intentionally invalid payload to drive validation
          ctx.broadcast.message({ wrong: 1 });
        },
      },
    });
    const harness = new ChannelHarness(ch, {});
    await harness.connect('alice', {});
    await expect(harness.send('alice', 'trigger', {})).rejects.toBeInstanceOf(
      ValidationException,
    );
  });
});

// ---------------------------------------------------------------------------
// beforeHandler support
// ---------------------------------------------------------------------------

describe('ChannelHarness — beforeHandler', () => {
  it('populates ctx.state from beforeHandler return value', async () => {
    const ch = channel({
      name: 'bhState',
      path: '/ws/bh',
      summary: 'bh',
      beforeHandler: async () => ({
        ok: true as const,
        state: { userId: 'alice-from-before' } as Record<string, unknown>,
      }),
      clientMessages: {
        ping: { schema: t.model('BHPing', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('BHPong', { who: t.string() }), description: 'p' },
      },
      onConnect: (ctx) => {
        ctx.state.verified = true;
      },
      handlers: {
        ping: (ctx) => {
          ctx.send.pong({ who: ctx.state.userId as string });
        },
      },
    });
    const harness = new ChannelHarness(ch, {});
    const client = await harness.connect('alice', {});
    expect(client.rejected).toBe(false);
    expect(client.state.userId).toBe('alice-from-before');
    expect(client.state.verified).toBe(true);
    await harness.send('alice', 'ping', {});
    expect(client.receivedOf('pong')[0]?.data).toEqual({ who: 'alice-from-before' });
  });

  it('rejects the connection when beforeHandler returns ok: false', async () => {
    const ch = channel({
      name: 'bhReject',
      path: '/ws/bhr',
      summary: 'bhr',
      beforeHandler: async () => ({
        ok: false as const,
        code: 401,
        message: 'bad token',
      }),
      clientMessages: {
        ping: { schema: t.model('BHRPing', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('BHRPong', {}), description: 'p' },
      },
      handlers: { ping: () => {} },
    });
    const harness = new ChannelHarness(ch, {});
    const client = await harness.connect('alice', {});
    expect(client.rejected).toBe(true);
    expect(client.rejectedCode).toBe(401);
    expect(client.rejectedMessage).toBe('bad token');
    expect(harness.getClient('alice')).toBeUndefined();
  });

  it('rejects the connection when beforeHandler throws', async () => {
    const ch = channel({
      name: 'bhThrow',
      path: '/ws/bht',
      summary: 'bht',
      beforeHandler: async () => {
        throw new Error('auth service down');
      },
      clientMessages: {
        ping: { schema: t.model('BHTPing', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('BHTPong', {}), description: 'p' },
      },
      handlers: { ping: () => {} },
    });
    const harness = new ChannelHarness(ch, {});
    const client = await harness.connect('alice', {});
    expect(client.rejected).toBe(true);
    expect(client.rejectedCode).toBe(4500);
    expect(harness.getClient('alice')).toBeUndefined();
  });

  it('passes raw params, query, headers and services to beforeHandler', async () => {
    let captured: Record<string, unknown> = {};
    const ch = channel({
      name: 'bhCtx',
      path: '/ws/bhc',
      summary: 'bhc',
      beforeHandler: async (ctx) => {
        captured = {
          rawParams: ctx.rawParams,
          rawQuery: ctx.rawQuery,
          rawHeaders: ctx.rawHeaders,
          hasServices: ctx.services !== undefined,
        };
        return { ok: true as const, state: {} };
      },
      clientMessages: {
        ping: { schema: t.model('BHCPing', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('BHCPong', {}), description: 'p' },
      },
      handlers: { ping: () => {} },
    });
    const harness = new ChannelHarness(ch, {});
    await harness.connect('alice', {
      params: { roomId: 'r1' },
      query: { token: 'abc' },
      headers: { authorization: 'Bearer xyz' },
    });
    expect(captured.rawParams).toEqual({ roomId: 'r1' });
    expect(captured.rawQuery).toEqual({ token: 'abc' });
    expect(captured.rawHeaders).toEqual({ authorization: 'Bearer xyz' });
    expect(captured.hasServices).toBe(true);
  });

  it('runs beforeHandler BEFORE schema validation so auth can reject first', async () => {
    const callOrder: string[] = [];
    const ch = channel({
      name: 'bhOrder',
      path: '/ws/bho',
      summary: 'bho',
      connection: {
        headers: { authorization: t.string() },
      },
      beforeHandler: async () => {
        callOrder.push('beforeHandler');
        return { ok: false as const, code: 401, message: 'no auth' };
      },
      onConnect: () => {
        callOrder.push('onConnect');
      },
      clientMessages: {
        ping: { schema: t.model('BHOPing', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('BHOPong', {}), description: 'p' },
      },
      handlers: { ping: () => {} },
    });
    const harness = new ChannelHarness(ch, {});
    // No authorization header — would normally fail validation with 4400
    const client = await harness.connect('alice', {});
    // beforeHandler should have rejected with 401 BEFORE validation ran
    expect(client.rejected).toBe(true);
    expect(client.rejectedCode).toBe(401);
    expect(callOrder).toEqual(['beforeHandler']);
  });

  it('existing behavior unchanged when no beforeHandler is present', async () => {
    const harness = new ChannelHarness(makeRoomChannel(), {});
    const client = await harness.connect('alice', { params: { roomId: 'r1' } });
    expect(client.rejected).toBe(false);
    expect(client.state.user).toBe('anon');
  });
});

describe('ChannelHarness — disconnect', () => {
  it('removes the client from its group and calls onDisconnect', async () => {
    let disconnectedFor: string | undefined;
    const ch = channel({
      name: 'discCh',
      path: '/ws/rooms/:roomId',
      summary: 'd',
      connection: { params: { roomId: t.string() } },
      clientMessages: {
        sendMessage: { schema: ChatMessage, description: 's' },
      },
      serverMessages: {
        message: { schema: ChatMessage, description: 'm' },
      },
      onConnect: (ctx) => {
        ctx.state.who = 'someone';
      },
      onDisconnect: (ctx) => {
        disconnectedFor = (ctx.state as { who?: string }).who;
      },
      handlers: {
        sendMessage: (ctx, data) => ctx.broadcast.message(data),
      },
    });
    const harness = new ChannelHarness(ch, {});
    const alice = await harness.connect('alice', { params: { roomId: 'r1' } });
    const bob = await harness.connect('bob', { params: { roomId: 'r1' } });
    await harness.disconnect('alice');
    expect(disconnectedFor).toBe('someone');
    expect(harness.getClient('alice')).toBeUndefined();
    // Alice should not receive any new broadcasts
    await harness.send('bob', 'sendMessage', { from: 'bob', text: 'hi' });
    expect(alice.receivedOf('message')).toHaveLength(0);
    expect(bob.receivedOf('message')).toHaveLength(1);
  });
});
