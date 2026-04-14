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
import { channel, createRouter, t } from '@triadjs/core';
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

// ---------------------------------------------------------------------------
// Phase 10.5 — Fix 2: validateBeforeConnect option
// ---------------------------------------------------------------------------

describe('channel adapter — validateBeforeConnect option', () => {
  async function startDeferredServer(opts: {
    onConnectBehavior: 'reject-401' | 'reject-custom' | 'do-nothing';
  }): Promise<RunningServer> {
    const app = Fastify({ logger: false });
    const router = createRouter({ title: 'Deferred', version: '1' });
    const Ping = t.model('Ping', { nonce: t.string() });
    const deferred = channel({
      name: 'deferredAuth',
      path: '/ws/deferred',
      summary: 'Deferred handshake validation',
      connection: {
        headers: {
          authorization: t.string(),
        },
        validateBeforeConnect: false,
      },
      clientMessages: {
        ping: { schema: Ping, description: 'p' },
      },
      serverMessages: {
        pong: { schema: Ping, description: 'p' },
      },
      onConnect: (ctx) => {
        const errs = (
          ctx as unknown as { validationError?: readonly unknown[] }
        ).validationError;
        if (errs && errs.length > 0) {
          if (opts.onConnectBehavior === 'reject-401') {
            ctx.reject(401, 'missing or invalid authorization header');
            return;
          }
          if (opts.onConnectBehavior === 'reject-custom') {
            ctx.reject(418, 'teapot-auth');
            return;
          }
          // do-nothing: let the adapter fall back to its default close.
        }
      },
      handlers: {
        ping: (ctx, data) => ctx.send.pong(data),
      },
    });
    router.add(deferred);
    await app.register(triadPlugin, { router });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Fastify did not bind to a TCP port');
    }
    return { app, port: address.port, sockets: [] };
  }

  it('default validateBeforeConnect (unset) keeps the old behavior: missing header auto-closes before onConnect', async () => {
    // Uses the top-level `chatRoom` channel which does NOT set the
    // option — equivalent to `validateBeforeConnect: true` and must
    // behave exactly like existing tests.
    server = await startServer();
    const socket = await openClient(server, '/ws/rooms/abc', {
      expectClose: true,
    });
    const close = await waitForClose(socket);
    expect(close.code).toBe(4400);
  });

  it('validateBeforeConnect: false defers validation so onConnect can render a custom rejection', async () => {
    server = await startDeferredServer({ onConnectBehavior: 'reject-401' });
    const messages: Envelope[] = [];
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/deferred`,
      // NOTE: no authorization header
    );
    server.sockets.push(socket);
    socket.on('message', (raw: Buffer) => {
      try {
        messages.push(JSON.parse(raw.toString('utf8')) as Envelope);
      } catch {
        /* ignore */
      }
    });
    const close = await waitForClose(socket);
    // 4000 + 401 = 4401 per the adapter's close-code convention.
    expect(close.code).toBe(4401);
    const err = messages.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { code: string }).code).toBe('CONNECTION_REJECTED');
  });

  it('validateBeforeConnect: false with valid headers proceeds through the normal flow', async () => {
    server = await startDeferredServer({ onConnectBehavior: 'reject-401' });
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/deferred`,
      { headers: { authorization: 'Bearer valid' } },
    );
    server.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (err) => reject(err));
      socket.once('close', (code, reason) =>
        reject(
          new Error(
            `socket closed: code=${code} reason=${reason.toString()}`,
          ),
        ),
      );
    });
    socket.send(JSON.stringify({ type: 'ping', data: { nonce: 'n1' } }));
    const env = await waitForType(socket, 'pong');
    expect(env).toEqual({ type: 'pong', data: { nonce: 'n1' } });
  });

  it('validateBeforeConnect: false falls back to 4400 close when onConnect does not reject', async () => {
    server = await startDeferredServer({ onConnectBehavior: 'do-nothing' });
    const messages: Envelope[] = [];
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/deferred`,
    );
    server.sockets.push(socket);
    socket.on('message', (raw: Buffer) => {
      try {
        messages.push(JSON.parse(raw.toString('utf8')) as Envelope);
      } catch {
        /* ignore */
      }
    });
    const close = await waitForClose(socket);
    expect(close.code).toBe(4400);
    const err = messages.find((m) => m.type === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { code: string }).code).toBe('VALIDATION_ERROR');
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

// ---------------------------------------------------------------------------
// First-message auth fixture
// ---------------------------------------------------------------------------

interface AuthedRoomState {
  userId: string;
}

const authedRoom = channel({
  name: 'authedRoom',
  path: '/ws/authed/:roomId',
  summary: 'Authed room that expects first-message auth',
  state: {} as AuthedRoomState,
  auth: {
    strategy: 'first-message',
    firstMessageType: '__auth',
    timeoutMs: 200,
  },
  connection: {
    params: {
      roomId: t.string(),
    },
  },
  clientMessages: {
    __auth: {
      schema: t.model('AuthPayload', { token: t.string().minLength(1) }),
      description: 'Auth payload',
    },
    sendMessage: {
      schema: t.model('AuthedSendMessage', {
        text: t.string().minLength(1),
      }),
      description: 'Send a message',
    },
  },
  serverMessages: {
    message: {
      schema: t.model('AuthedMessage', {
        userId: t.string(),
        text: t.string(),
      }),
      description: 'New message',
    },
  },
  onConnect: (ctx) => {
    const payload = ctx.authPayload as { token: string } | undefined;
    if (!payload || payload.token !== 'valid-token') {
      ctx.reject(401, 'Invalid token');
      return;
    }
    ctx.state.userId = `user-for-${payload.token}`;
  },
  handlers: {
    __auth: () => {
      // no-op — consumed by the auth flow, never runs as a normal message
    },
    sendMessage: (ctx, data) => {
      ctx.broadcast.message({
        userId: ctx.state.userId,
        text: data.text,
      });
    },
  },
});

async function startAuthedServer(): Promise<RunningServer> {
  const app = Fastify({ logger: false });
  const router = createRouter({ title: 'AuthedTest', version: '1.0.0' });
  router.add(authedRoom);
  await app.register(triadPlugin, { router });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fastify did not bind to a TCP port');
  }
  return { app, port: address.port, sockets: [] };
}

describe('channel adapter — first-message auth', () => {
  it('runs onConnect with ctx.authPayload once the auth message arrives', async () => {
    server = await startAuthedServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/authed/abc`,
    );
    server.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({ type: '__auth', data: { token: 'valid-token' } }),
    );
    // Give onConnect a moment to run before sending another message.
    await new Promise((r) => setTimeout(r, 50));
    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hi' } }));
    const envelope = await waitForType(socket, 'message');
    expect(envelope).toEqual({
      type: 'message',
      data: { userId: 'user-for-valid-token', text: 'hi' },
    });
  });

  it('closes with 4401 when the auth payload fails ctx.reject', async () => {
    server = await startAuthedServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/authed/abc`,
    );
    server.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({ type: '__auth', data: { token: 'bogus' } }),
    );
    const close = await waitForClose(socket);
    expect(close.code).toBe(4401);
  });

  it('closes with 4401 if no message arrives before the timeout', async () => {
    server = await startAuthedServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/authed/abc`,
    );
    server.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const close = await waitForClose(socket);
    expect(close.code).toBe(4401);
  });

  it('closes with 4401 if the first message is not the auth type', async () => {
    server = await startAuthedServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/authed/abc`,
    );
    server.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hi' } }));
    const close = await waitForClose(socket);
    expect(close.code).toBe(4401);
  });
});

// ---------------------------------------------------------------------------
// beforeHandler support
// ---------------------------------------------------------------------------

describe('channel adapter — beforeHandler', () => {
  async function startBeforeHandlerServer(opts: {
    behavior: 'populate-state' | 'reject-401' | 'throw';
  }): Promise<RunningServer> {
    const app = Fastify({ logger: false });
    const router = createRouter({ title: 'BeforeHandlerTest', version: '1' });

    const bhChannel = channel({
      name: 'bhChannel',
      path: '/ws/bh/:roomId',
      summary: 'beforeHandler test channel',
      connection: {
        params: { roomId: t.string() },
        headers: { 'x-token': t.string() },
      },
      beforeHandler: async (ctx) => {
        if (opts.behavior === 'throw') {
          throw new Error('auth service down');
        }
        const token = ctx.rawHeaders['x-token'];
        if (opts.behavior === 'reject-401' || !token) {
          return { ok: false as const, code: 401, message: 'unauthorized' };
        }
        return {
          ok: true as const,
          state: { userId: `user-for-${token}` },
        };
      },
      clientMessages: {
        sendMessage: {
          schema: t.model('BHSend', { text: t.string().minLength(1) }),
          description: 'Send',
        },
      },
      serverMessages: {
        message: {
          schema: t.model('BHMsg', { userId: t.string(), text: t.string() }),
          description: 'Msg',
        },
      },
      onConnect: (ctx) => {
        // state.userId should already be set by beforeHandler
      },
      handlers: {
        sendMessage: (ctx, data) => {
          ctx.broadcast.message({
            userId: (ctx.state as Record<string, unknown>).userId as string,
            text: data.text,
          });
        },
      },
    });
    router.add(bhChannel);
    await app.register(triadPlugin, { router });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Fastify did not bind to a TCP port');
    }
    return { app, port: address.port, sockets: [] };
  }

  it('beforeHandler populates state that handlers can read', async () => {
    server = await startBeforeHandlerServer({ behavior: 'populate-state' });
    const socket = await openClient(server, '/ws/bh/room1', {
      headers: { 'x-token': 'abc123' },
    });
    socket.send(JSON.stringify({ type: 'sendMessage', data: { text: 'hi' } }));
    const envelope = await waitForType(socket, 'message');
    expect((envelope.data as { userId: string }).userId).toBe('user-for-abc123');
  });

  it('beforeHandler rejects with custom code — socket closes', async () => {
    server = await startBeforeHandlerServer({ behavior: 'reject-401' });
    const socket = await openClient(server, '/ws/bh/room1', {
      headers: { 'x-token': 'anything' },
      expectClose: true,
    });
    const close = await waitForClose(socket);
    expect(close.code).toBe(4401);
  });

  it('beforeHandler throw closes the socket with 4500', async () => {
    server = await startBeforeHandlerServer({ behavior: 'throw' });
    const socket = await openClient(server, '/ws/bh/room1', {
      headers: { 'x-token': 'anything' },
      expectClose: true,
    });
    const close = await waitForClose(socket);
    expect(close.code).toBe(4500);
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
