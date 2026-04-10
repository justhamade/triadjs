/**
 * End-to-end WebSocket integration tests.
 *
 * Unlike `plugin.test.ts`, these tests can't use `fastify.inject()` —
 * `@fastify/websocket` only upgrades real TCP sockets, not the in-
 * process light-my-request transport. So each test boots a real
 * Fastify server on an ephemeral port (`listen({ port: 0 })`), opens a
 * `ws` client, exchanges envelopes, and then tears everything down in
 * an `afterEach`.
 *
 * The fixture is a small chat-room channel — minimal enough to keep
 * the file focused, rich enough to exercise every surface the adapter
 * exposes: handshake validation, `onConnect` + `ctx.reject`, per-
 * connection state, `broadcast`, `broadcastOthers`, and `send`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { channel, createRouter, t } from '@triad/core';
import { triadPlugin } from '../src/plugin.js';

// ---------------------------------------------------------------------------
// Fixture: chat room channel
// ---------------------------------------------------------------------------

const ChatMessage = t.model('ChatMessage', {
  userId: t.string(),
  text: t.string().minLength(1),
});

const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string(),
  isTyping: t.boolean(),
});

const Ack = t.model('Ack', {
  messageId: t.string(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ChatRoomState {
  userId: string;
  joinedAt: number;
}

// Handy globals to wire test hooks into the channel without plumbing
// them through the services container for every assertion.
const disconnectEvents: string[] = [];
let rejectNextConnect: { code: number; message: string } | undefined;

const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Chat room',
  state: {} as ChatRoomState,
  connection: {
    params: {
      roomId: t.string(),
    },
    headers: {
      'x-user-id': t.string(),
    },
  },
  clientMessages: {
    sendMessage: {
      schema: t.model('SendMessagePayload', {
        text: t.string().minLength(1),
      }),
      description: 'Send a chat message',
    },
    typing: {
      schema: t.model('TypingPayload', { isTyping: t.boolean() }),
      description: 'Typing indicator',
    },
    ping: {
      schema: t.model('PingPayload', { nonce: t.string() }),
      description: 'Round-trip ping that should reach only the sender',
    },
  },
  serverMessages: {
    message: { schema: ChatMessage, description: 'New message' },
    typing: { schema: TypingIndicator, description: 'Typing update' },
    ack: { schema: Ack, description: 'Ack for a ping' },
  },
  onConnect: (ctx) => {
    if (rejectNextConnect) {
      const { code, message } = rejectNextConnect;
      rejectNextConnect = undefined;
      ctx.reject(code, message);
      return;
    }
    ctx.state.userId = ctx.headers['x-user-id'];
    ctx.state.joinedAt = Date.now();
  },
  onDisconnect: (ctx) => {
    if (ctx.state.userId) {
      disconnectEvents.push(ctx.state.userId);
    }
  },
  handlers: {
    sendMessage: (ctx, data) => {
      ctx.broadcast.message({
        userId: ctx.state.userId,
        text: data.text,
      });
    },
    typing: (ctx, data) => {
      ctx.broadcastOthers.typing({
        userId: ctx.state.userId,
        isTyping: data.isTyping,
      });
    },
    ping: (ctx, data) => {
      ctx.send.ack({ messageId: data.nonce });
    },
  },
});

// HTTP-only fixture for the backward-compat test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _httpOnlyMarker = 'http';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RunningServer {
  app: FastifyInstance;
  port: number;
  sockets: WebSocket[];
}

async function startServer(): Promise<RunningServer> {
  const app = Fastify({ logger: false });
  const router = createRouter({ title: 'ChatTest', version: '1.0.0' });
  router.add(chatRoom);
  await app.register(triadPlugin, { router });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fastify did not bind to a TCP port');
  }
  return { app, port: address.port, sockets: [] };
}

async function stopServer(server: RunningServer): Promise<void> {
  for (const socket of server.sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }
  await server.app.close();
}

interface OpenOptions {
  headers?: Record<string, string>;
  expectClose?: boolean;
}

async function openClient(
  server: RunningServer,
  path: string,
  options: OpenOptions = {},
): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${server.port}${path}`,
    options.headers ? { headers: options.headers } : undefined,
  );
  server.sockets.push(socket);
  if (options.expectClose) {
    return socket;
  }
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (err) => reject(err));
    socket.once('close', (code, reason) => {
      reject(
        new Error(
          `socket closed before open: code=${code} reason=${reason.toString()}`,
        ),
      );
    });
  });
  return socket;
}

interface Envelope {
  type: string;
  data: unknown;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (env: Envelope) => boolean = () => true,
  timeoutMs = 2000,
): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for message'));
    }, timeoutMs);

    function onMessage(raw: Buffer): void {
      let parsed: Envelope;
      try {
        parsed = JSON.parse(raw.toString('utf8')) as Envelope;
      } catch {
        return;
      }
      if (predicate(parsed)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(parsed);
      }
    }

    socket.on('message', onMessage);
  });
}

function waitForType(socket: WebSocket, type: string): Promise<Envelope> {
  return waitForMessage(socket, (env) => env.type === type);
}

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function expectNoMessage(socket: WebSocket, ms = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      reject(new Error(`unexpected message: ${raw.toString('utf8')}`));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, ms);
    socket.on('message', onMessage);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let server: RunningServer | undefined;

afterEach(async () => {
  if (server) {
    await stopServer(server);
    server = undefined;
  }
  disconnectEvents.length = 0;
  rejectNextConnect = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('channel adapter — single client', () => {
  it('round-trips a sendMessage through broadcast back to the sender', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });

    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hi' } }));
    const envelope = await waitForType(socket, 'message');

    expect(envelope).toEqual({
      type: 'message',
      data: { userId: 'alice', text: 'hi' },
    });
  });
});

describe('channel adapter — multi-client broadcast', () => {
  it('broadcast reaches every client in the same room, including the sender', async () => {
    server = await startServer();
    const a = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });
    const b = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'bob' },
    });

    const msgA = waitForType(a, 'message');
    const msgB = waitForType(b, 'message');
    a.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hello' } }));

    await expect(msgA).resolves.toEqual({
      type: 'message',
      data: { userId: 'alice', text: 'hello' },
    });
    await expect(msgB).resolves.toEqual({
      type: 'message',
      data: { userId: 'alice', text: 'hello' },
    });
  });

  it('broadcastOthers skips the sender', async () => {
    server = await startServer();
    const a = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });
    const b = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'bob' },
    });

    const recvB = waitForType(b, 'typing');
    const silenceA = expectNoMessage(a, 200);
    a.send(JSON.stringify({ type: 'typing', data: { isTyping: true } }));

    await expect(recvB).resolves.toEqual({
      type: 'typing',
      data: { userId: 'alice', isTyping: true },
    });
    await silenceA;
  });

  it('broadcasts are scoped by path params — room abc does not leak to room xyz', async () => {
    server = await startServer();
    const a = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });
    const b = await openClient(server, '/ws/rooms/xyz', {
      headers: { 'x-user-id': 'bob' },
    });

    const recvA = waitForType(a, 'message');
    const silenceB = expectNoMessage(b, 200);
    a.send(JSON.stringify({ type: 'sendMessage', data: { text: 'secret' } }));

    await recvA;
    await silenceB;
  });
});

describe('channel adapter — error envelopes keep the socket open', () => {
  it('sends an error envelope for invalid JSON', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });

    socket.send('not json');
    const err = await waitForType(socket, 'error');
    expect((err.data as { code: string }).code).toBe('INVALID_JSON');
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('sends an error envelope for an unknown message type', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });

    socket.send(JSON.stringify({ type: 'notAThing', data: {} }));
    const err = await waitForType(socket, 'error');
    expect((err.data as { code: string }).code).toBe('UNKNOWN_MESSAGE_TYPE');
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('sends an error envelope with validation details for an invalid payload', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });

    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: '' } }));
    const err = await waitForType(socket, 'error');
    const payload = err.data as { code: string; details: unknown };
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(payload.details)).toBe(true);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('channel adapter — handshake', () => {
  it('closes with 4400 when a required header is missing', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      expectClose: true,
    });

    const messages: Envelope[] = [];
    socket.on('message', (raw: Buffer) => {
      try {
        messages.push(JSON.parse(raw.toString('utf8')) as Envelope);
      } catch {
        /* ignore */
      }
    });

    const close = await waitForClose(socket);
    expect(close.code).toBe(4400);
    expect(messages.find((m) => m.type === 'error')).toBeDefined();
  });

  it('closes with 4000+httpCode when onConnect rejects', async () => {
    server = await startServer();
    rejectNextConnect = { code: 401, message: 'unauthorized' };

    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'mallory' },
      expectClose: true,
    });

    const messages: Envelope[] = [];
    socket.on('message', (raw: Buffer) => {
      try {
        messages.push(JSON.parse(raw.toString('utf8')) as Envelope);
      } catch {
        /* ignore */
      }
    });

    const close = await waitForClose(socket);
    expect(close.code).toBe(4401);
    const errMsg = messages.find((m) => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect((errMsg!.data as { code: string }).code).toBe('CONNECTION_REJECTED');
  });
});

describe('channel adapter — connection lifecycle', () => {
  it('onConnect mutates state that later handlers can read', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });

    // `sendMessage` handler reads `ctx.state.userId`, so seeing "alice"
    // echoed back proves onConnect ran and the mutation persisted.
    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hi' } }));
    const msg = await waitForType(socket, 'message');
    expect((msg.data as { userId: string }).userId).toBe('alice');
  });

  it('onDisconnect fires with access to the same state bag', async () => {
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'charlie' },
    });
    socket.close();
    // Wait briefly for the close handler to run server-side.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(disconnectEvents).toContain('charlie');
  });
});

describe('channel adapter — send scope', () => {
  it('ctx.send reaches only the sender, not other clients in the room', async () => {
    server = await startServer();
    const a = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'alice' },
    });
    const b = await openClient(server, '/ws/rooms/abc', {
      headers: { 'x-user-id': 'bob' },
    });

    const recvA = waitForType(a, 'ack');
    const silenceB = expectNoMessage(b, 200);
    a.send(JSON.stringify({ type: 'ping', data: { nonce: 'n1' } }));

    await expect(recvA).resolves.toEqual({
      type: 'ack',
      data: { messageId: 'n1' },
    });
    await silenceB;
  });
});

describe('channel adapter — HTTP-only backward compat', () => {
  it('does not require @fastify/websocket when the router has no channels', async () => {
    // A pure HTTP router should work without loading @fastify/websocket
    // at all. We can't cleanly simulate an absent package (it's in
    // devDependencies), but we CAN assert that plugin registration
    // succeeds and the server boots for an HTTP-only router.
    const app = Fastify({ logger: false });
    const router = createRouter({ title: 'HttpOnly', version: '1.0.0' });
    // No channels registered.
    await app.register(triadPlugin, { router });
    await app.ready();
    // The fastify instance should not have a websocketServer field
    // because we never registered @fastify/websocket.
    expect(
      (app as unknown as { websocketServer?: unknown }).websocketServer,
    ).toBeUndefined();
    await app.close();
  });
});
