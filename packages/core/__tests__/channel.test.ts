import { describe, expect, it, expectTypeOf, vi } from 'vitest';
import {
  channel,
  isChannel,
  scenario,
  t,
  type BroadcastMap,
  type ChannelMessageContext,
} from '../src/index.js';
import { ModelSchema } from '../src/schema/model.js';

// ---------------------------------------------------------------------------
// Shared fixtures — a tiny chat channel
// ---------------------------------------------------------------------------

const ChatMessage = t.model('ChatMessage', {
  id: t.string().format('uuid'),
  roomId: t.string().format('uuid'),
  userId: t.string().format('uuid'),
  text: t.string().minLength(1).maxLength(2000),
  timestamp: t.datetime(),
});

const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string().format('uuid'),
  isTyping: t.boolean(),
});

const ErrorMessage = t.model('ErrorMessage', {
  code: t.string(),
  message: t.string(),
});

const SendMessagePayload = t.model('SendMessagePayload', {
  text: t.string().minLength(1).maxLength(2000),
});

const TypingPayload = t.model('TypingPayload', {
  isTyping: t.boolean(),
});

function buildChatRoom() {
  return channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Real-time chat room',
    description: 'Bidirectional messaging channel.',
    tags: ['Chat'],
    connection: {
      params: { roomId: t.string().format('uuid') },
      headers: { authorization: t.string() },
      query: {
        reconnectToken: t.string().optional(),
      },
    },
    clientMessages: {
      sendMessage: {
        schema: SendMessagePayload,
        description: 'Send a chat message',
      },
      typing: {
        schema: TypingPayload,
        description: 'Typing indicator',
      },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'New message' },
      typing: { schema: TypingIndicator, description: 'Typing update' },
      error: { schema: ErrorMessage, description: 'Error' },
    },
    handlers: {
      sendMessage: async (ctx, data) => {
        // Exercise the typed ctx.broadcast in the handler body.
        ctx.broadcast.message({
          id: '00000000-0000-0000-0000-000000000000',
          roomId: ctx.params.roomId,
          userId: '00000000-0000-0000-0000-000000000000',
          text: data.text,
          timestamp: '2026-04-10T12:00:00Z',
        });
      },
      typing: async (ctx, data) => {
        ctx.broadcastOthers.typing({
          userId: '00000000-0000-0000-0000-000000000000',
          isTyping: data.isTyping,
        });
      },
    },
    behaviors: [
      scenario('Users can send messages to a room')
        .given('a user is connected')
        .when('client sends sendMessage with text "Hello"')
        .then('all clients in the room receive a message event'),
    ],
  });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('channel() — construction', () => {
  const chatRoom = buildChatRoom();

  it('preserves name, path, summary, description, tags', () => {
    expect(chatRoom.name).toBe('chatRoom');
    expect(chatRoom.path).toBe('/ws/rooms/:roomId');
    expect(chatRoom.summary).toBe('Real-time chat room');
    expect(chatRoom.description).toBe('Bidirectional messaging channel.');
    expect(chatRoom.tags).toEqual(['Chat']);
  });

  it('marks the runtime object with kind: "channel"', () => {
    expect(chatRoom.kind).toBe('channel');
  });

  it('normalizes inline connection shapes to anonymous ModelSchemas', () => {
    expect(chatRoom.connection.params).toBeInstanceOf(ModelSchema);
    expect(chatRoom.connection.params?.name).toBe('chatRoomParams');
    expect(chatRoom.connection.query).toBeInstanceOf(ModelSchema);
    expect(chatRoom.connection.query?.name).toBe('chatRoomQuery');
    expect(chatRoom.connection.headers).toBeInstanceOf(ModelSchema);
    expect(chatRoom.connection.headers?.name).toBe('chatRoomHeaders');
  });

  it('passes through named connection models unchanged', () => {
    const RoomParams = t.model('RoomParams', {
      roomId: t.string().format('uuid'),
    });
    const ep = channel({
      name: 'withNamed',
      path: '/ws/rooms/:roomId',
      summary: 'x',
      connection: { params: RoomParams },
      clientMessages: {
        ping: { schema: t.model('PingPayload', {}), description: 'ping' },
      },
      serverMessages: {
        pong: { schema: t.model('PongPayload', {}), description: 'pong' },
      },
      handlers: {
        ping: async () => {},
      },
    });
    expect(ep.connection.params).toBe(RoomParams);
  });

  it('stores client and server message schemas', () => {
    expect(chatRoom.clientMessages.sendMessage?.schema).toBe(SendMessagePayload);
    expect(chatRoom.serverMessages.message?.schema).toBe(ChatMessage);
    expect(chatRoom.serverMessages.typing?.schema).toBe(TypingIndicator);
  });

  it('stores handlers keyed by client message type', () => {
    expect(typeof chatRoom.handlers.sendMessage).toBe('function');
    expect(typeof chatRoom.handlers.typing).toBe('function');
  });

  it('stores behaviors', () => {
    expect(chatRoom.behaviors).toHaveLength(1);
    expect(chatRoom.behaviors[0]?.scenario).toBe(
      'Users can send messages to a room',
    );
  });

  it('defaults missing optional fields', () => {
    const minimal = channel({
      name: 'minimal',
      path: '/ws/min',
      summary: 'minimal',
      clientMessages: {
        ping: { schema: t.model('P', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('Q', {}), description: 'q' },
      },
      handlers: { ping: async () => {} },
    });
    expect(minimal.tags).toEqual([]);
    expect(minimal.behaviors).toEqual([]);
    expect(minimal.description).toBeUndefined();
    expect(minimal.connection.params).toBeUndefined();
    expect(minimal.connection.query).toBeUndefined();
    expect(minimal.connection.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isChannel brand check
// ---------------------------------------------------------------------------

describe('isChannel', () => {
  it('returns true for channels built by channel()', () => {
    const c = buildChatRoom();
    expect(isChannel(c)).toBe(true);
  });

  it('returns false for endpoints (no clientMessages, different brand)', async () => {
    const { endpoint } = await import('../src/index.js');
    const ep = endpoint({
      name: 'e',
      method: 'GET',
      path: '/e',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
    });
    expect(isChannel(ep)).toBe(false);
  });

  it('returns false for arbitrary values', () => {
    expect(isChannel(null)).toBe(false);
    expect(isChannel({})).toBe(false);
    expect(isChannel({ kind: 'channel' })).toBe(false); // no brand
    expect(isChannel('channel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler invocation — verify types line up at the value level
// ---------------------------------------------------------------------------

describe('channel() — handlers can be invoked with a synthetic context', () => {
  it('passes typed data through to the handler body', async () => {
    const broadcasts: Array<{ type: string; data: unknown }> = [];
    const record: BroadcastMap<{
      message: { schema: typeof ChatMessage; description: string };
      typing: { schema: typeof TypingIndicator; description: string };
      error: { schema: typeof ErrorMessage; description: string };
    }> = {
      message: (data) => {
        broadcasts.push({ type: 'message', data });
      },
      typing: (data) => {
        broadcasts.push({ type: 'typing', data });
      },
      error: (data) => {
        broadcasts.push({ type: 'error', data });
      },
    };

    const chatRoom = buildChatRoom();
    const sendMessage = chatRoom.handlers.sendMessage!;

    const ctx: ChannelMessageContext<
      { roomId: string },
      {
        message: { schema: typeof ChatMessage; description: string };
        typing: { schema: typeof TypingIndicator; description: string };
        error: { schema: typeof ErrorMessage; description: string };
      }
    > = {
      params: { roomId: '00000000-0000-0000-0000-000000000001' },
      services: {},
      state: {},
      broadcast: record,
      broadcastOthers: record,
      send: record,
    };

    await sendMessage(ctx, { text: 'hello world' });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.type).toBe('message');
    expect(
      (broadcasts[0]?.data as { text: string }).text,
    ).toBe('hello world');
  });

  it('routes typing to broadcastOthers, not broadcast', async () => {
    const toAll = vi.fn();
    const toOthers = vi.fn();
    const toSelf = vi.fn();

    const chatRoom = buildChatRoom();
    const typingHandler = chatRoom.handlers.typing!;

    const ctx = {
      params: { roomId: '00000000-0000-0000-0000-000000000001' },
      services: {},
      state: {},
      broadcast: { typing: toAll, message: vi.fn(), error: vi.fn() },
      broadcastOthers: { typing: toOthers, message: vi.fn(), error: vi.fn() },
      send: { typing: toSelf, message: vi.fn(), error: vi.fn() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await typingHandler(ctx, { isTyping: true });

    expect(toOthers).toHaveBeenCalledTimes(1);
    expect(toAll).not.toHaveBeenCalled();
    expect(toSelf).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Type-level inference
// ---------------------------------------------------------------------------

describe('channel() — type inference', () => {
  it('infers typed ctx.params from inline connection.params', () => {
    channel({
      name: 'typecheck1',
      path: '/ws/rooms/:roomId',
      summary: 'x',
      connection: { params: { roomId: t.string().format('uuid') } },
      clientMessages: {
        ping: { schema: t.model('P', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('Q', {}), description: 'q' },
      },
      handlers: {
        ping: async (ctx) => {
          expectTypeOf(ctx.params).toMatchTypeOf<{ roomId: string }>();
        },
      },
    });
  });

  it('infers typed data from the clientMessages schema', () => {
    const Payload = t.model('Payload', {
      amount: t.int32(),
      note: t.string().optional(),
    });
    channel({
      name: 'typecheck2',
      path: '/ws/charge',
      summary: 'x',
      clientMessages: {
        charge: { schema: Payload, description: 'charge' },
      },
      serverMessages: {
        ack: { schema: t.model('Ack', {}), description: 'ack' },
      },
      handlers: {
        charge: async (_ctx, data) => {
          expectTypeOf(data).toMatchTypeOf<{
            amount: number;
            note?: string;
          }>();
        },
      },
    });
  });

  it('ctx.broadcast only exposes declared server messages', () => {
    channel({
      name: 'typecheck3',
      path: '/ws/t3',
      summary: 'x',
      clientMessages: {
        x: { schema: t.model('X', {}), description: 'x' },
      },
      serverMessages: {
        ok: { schema: t.model('Ok', { code: t.string() }), description: 'ok' },
      },
      handlers: {
        x: async (ctx) => {
          expectTypeOf(ctx.broadcast.ok).toBeFunction();
          // @ts-expect-error — not declared
          ctx.broadcast.notDeclared?.({ any: 'thing' });
        },
      },
    });
  });

  it('typed ctx.state via the phantom `state` witness field', () => {
    interface ChatState {
      user: { id: string; name: string };
      roomId: string;
    }
    channel({
      name: 'typecheck4',
      path: '/ws/chat/:roomId',
      summary: 'x',
      // Phantom witness — only used for type inference of TState.
      state: {} as ChatState,
      connection: { params: { roomId: t.string() } },
      clientMessages: {
        ping: { schema: t.model('P', {}), description: 'p' },
      },
      serverMessages: {
        pong: { schema: t.model('Q', {}), description: 'q' },
      },
      onConnect: async (ctx) => {
        expectTypeOf(ctx.state).toMatchTypeOf<ChatState>();
        // params is still fully inferred because no explicit generics
        // blocked inference of the other parameters.
        expectTypeOf(ctx.params).toMatchTypeOf<{ roomId: string }>();
        ctx.state.user = { id: '1', name: 'Alice' };
        ctx.state.roomId = ctx.params.roomId;
      },
      handlers: {
        ping: async (ctx) => {
          expectTypeOf(ctx.state).toMatchTypeOf<ChatState>();
          const { id } = ctx.state.user;
          expectTypeOf(id).toBeString();
        },
      },
    });
  });

  it('default ctx.state is a permissive record when TState is omitted', () => {
    channel({
      name: 'typecheck5',
      path: '/ws/t5',
      summary: 'x',
      clientMessages: {
        x: { schema: t.model('X', {}), description: 'x' },
      },
      serverMessages: {
        y: { schema: t.model('Y', {}), description: 'y' },
      },
      handlers: {
        x: async (ctx) => {
          // No type errors for arbitrary key access.
          ctx.state.anything = 42;
          ctx.state.other = 'ok';
        },
      },
    });
  });
});
