import { describe, expect, it } from 'vitest';
import { channel, createRouter, t } from '@triadjs/core';
import { convertPath, generateAsyncAPI } from '../src/generator.js';
import { toJson, toYaml } from '../src/serialize.js';

// ---------------------------------------------------------------------------
// Shared test fixtures — a small chat-room channel
// ---------------------------------------------------------------------------

const ChatMessage = t.model('ChatMessage', {
  id: t.string().format('uuid').identity().doc('Unique message id'),
  roomId: t.string().format('uuid').doc('Owning room'),
  authorId: t.string().doc('Author user id'),
  text: t.string().minLength(1).doc('Message body').example('Hello'),
  createdAt: t.string().format('date-time').doc('Creation timestamp'),
});

const SendMessagePayload = t.model('SendMessagePayload', {
  text: t.string().minLength(1).doc('Message body'),
});

const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string().doc('Who is typing'),
  isTyping: t.boolean().doc('Typing state'),
});

const UserPresence = t.model('UserPresence', {
  userId: t.string().doc('User id'),
  status: t.enum('online', 'away', 'offline').doc('Presence state'),
});

const ApiError = t.model('ApiError', {
  code: t.string().doc('Error code'),
  message: t.string().doc('Human-readable message'),
});

const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Realtime chat room',
  description: 'Bidirectional chat channel for a single room',
  tags: ['Chat'],
  connection: {
    params: {
      roomId: t.string().format('uuid').doc('The room identifier'),
    },
    headers: {
      authorization: t.string().doc('Bearer token'),
    },
    query: {
      since: t.string().format('date-time').optional().doc('Resume from timestamp'),
    },
  },
  clientMessages: {
    sendMessage: {
      schema: SendMessagePayload,
      description: 'Client sends a new message',
    },
    typing: {
      schema: TypingIndicator,
      description: 'Client reports typing state',
    },
  },
  serverMessages: {
    message: {
      schema: ChatMessage,
      description: 'Broadcast when a message is posted',
    },
    presence: {
      schema: UserPresence,
      description: 'Broadcast when presence changes',
    },
    error: {
      schema: ApiError,
      description: 'Server-reported error',
    },
  },
  handlers: {
    sendMessage: () => {},
    typing: () => {},
  },
});

function buildRouter() {
  const router = createRouter({
    title: 'Chat API',
    version: '1.0.0',
    description: 'A sample Triad WebSocket API',
    servers: [{ url: 'wss://api.example.com/ws', description: 'Production' }],
  });
  router.add(chatRoom);
  return router;
}

// ---------------------------------------------------------------------------
// convertPath
// ---------------------------------------------------------------------------

describe('convertPath', () => {
  it('converts :id → {id}', () => {
    expect(convertPath('/ws/rooms/:roomId')).toBe('/ws/rooms/{roomId}');
  });

  it('converts multiple params', () => {
    expect(convertPath('/ws/orgs/:orgId/rooms/:roomId')).toBe(
      '/ws/orgs/{orgId}/rooms/{roomId}',
    );
  });

  it('leaves paths without params untouched', () => {
    expect(convertPath('/ws/lobby')).toBe('/ws/lobby');
  });

  it('handles underscores and digits in param names', () => {
    expect(convertPath('/v1/rooms/:room_id_2')).toBe('/v1/rooms/{room_id_2}');
  });
});

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — document structure', () => {
  const doc = generateAsyncAPI(buildRouter());

  it('emits AsyncAPI 3.0.0', () => {
    expect(doc.asyncapi).toBe('3.0.0');
  });

  it('populates info from router config', () => {
    expect(doc.info).toEqual({
      title: 'Chat API',
      version: '1.0.0',
      description: 'A sample Triad WebSocket API',
    });
  });

  it('populates servers from router config', () => {
    expect(doc.servers).toBeDefined();
    const entries = Object.values(doc.servers ?? {});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      host: 'api.example.com',
      protocol: 'wss',
      description: 'Production',
    });
  });

  it('registers channels keyed by channel name', () => {
    expect(doc.channels['chatRoom']).toBeDefined();
  });

  it('converts Fastify-style path params on channel address', () => {
    expect(doc.channels['chatRoom']?.address).toBe('/ws/rooms/{roomId}');
  });

  it('channel summary and description propagate', () => {
    const ch = doc.channels['chatRoom']!;
    expect(ch.summary).toBe('Realtime chat room');
    expect(ch.description).toBe('Bidirectional chat channel for a single room');
  });

  it('registers all named payload models in components/schemas', () => {
    expect(doc.components.schemas['ChatMessage']).toBeDefined();
    expect(doc.components.schemas['SendMessagePayload']).toBeDefined();
    expect(doc.components.schemas['TypingIndicator']).toBeDefined();
    expect(doc.components.schemas['UserPresence']).toBeDefined();
    expect(doc.components.schemas['ApiError']).toBeDefined();
  });

  it('registers one component message per client + server message', () => {
    expect(doc.components.messages['chatRoom.client.sendMessage']).toBeDefined();
    expect(doc.components.messages['chatRoom.client.typing']).toBeDefined();
    expect(doc.components.messages['chatRoom.server.message']).toBeDefined();
    expect(doc.components.messages['chatRoom.server.presence']).toBeDefined();
    expect(doc.components.messages['chatRoom.server.error']).toBeDefined();
  });

  it('component messages reference payload schemas by $ref', () => {
    const msg = doc.components.messages['chatRoom.server.message']!;
    expect(msg.name).toBe('message');
    expect(msg.summary).toBe('Broadcast when a message is posted');
    expect(msg.payload).toEqual({ $ref: '#/components/schemas/ChatMessage' });
  });

  it('channel.messages map is keyed by message type', () => {
    const ch = doc.channels['chatRoom']!;
    expect(ch.messages['sendMessage']).toEqual({
      $ref: '#/components/messages/chatRoom.client.sendMessage',
    });
    expect(ch.messages['message']).toEqual({
      $ref: '#/components/messages/chatRoom.server.message',
    });
  });
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — operations', () => {
  const doc = generateAsyncAPI(buildRouter());

  it('clientMessages become receive operations', () => {
    const op = doc.operations['chatRoom.client.sendMessage'];
    expect(op).toBeDefined();
    expect(op?.action).toBe('receive');
    expect(op?.channel).toEqual({ $ref: '#/channels/chatRoom' });
  });

  it('serverMessages become send operations', () => {
    const op = doc.operations['chatRoom.server.message'];
    expect(op).toBeDefined();
    expect(op?.action).toBe('send');
  });

  it('operation messages reference the channel-local message ref', () => {
    const op = doc.operations['chatRoom.server.message']!;
    expect(op.messages).toEqual([
      { $ref: '#/channels/chatRoom/messages/message' },
    ]);
  });

  it('operation descriptions come from the message description', () => {
    expect(doc.operations['chatRoom.client.sendMessage']?.summary).toBe(
      'Client sends a new message',
    );
    expect(doc.operations['chatRoom.server.presence']?.summary).toBe(
      'Broadcast when presence changes',
    );
  });

  it('emits one operation per declared message', () => {
    const chatRoomOps = Object.keys(doc.operations).filter((k) =>
      k.startsWith('chatRoom.'),
    );
    // 2 client + 3 server = 5
    expect(chatRoomOps).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — parameters', () => {
  const doc = generateAsyncAPI(buildRouter());

  it('channels with connection.params get an AsyncAPI parameter entry', () => {
    const ch = doc.channels['chatRoom']!;
    expect(ch.parameters?.['roomId']).toBeDefined();
    expect(ch.parameters?.['roomId']?.description).toBe('The room identifier');
  });

  it('enum schemas lift onto parameter.enum', () => {
    const router = createRouter({ title: 't', version: '1' });
    router.add(
      channel({
        name: 'rooms',
        path: '/ws/rooms/:tier',
        summary: 'Tiered rooms',
        connection: {
          params: {
            tier: t.enum('free', 'pro', 'enterprise').doc('Subscription tier'),
          },
        },
        clientMessages: {},
        serverMessages: {},
        handlers: {},
      }),
    );
    const d = generateAsyncAPI(router);
    expect(d.channels['rooms']?.parameters?.['tier']?.enum).toEqual([
      'free',
      'pro',
      'enterprise',
    ]);
  });

  it('channels without connection.params omit the parameters field', () => {
    const router = createRouter({ title: 't', version: '1' });
    router.add(
      channel({
        name: 'lobby',
        path: '/ws/lobby',
        summary: 'Global lobby',
        clientMessages: {},
        serverMessages: {},
        handlers: {},
      }),
    );
    const d = generateAsyncAPI(router);
    expect(d.channels['lobby']?.parameters).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bindings (headers, query)
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — bindings', () => {
  const doc = generateAsyncAPI(buildRouter());

  it('channels with connection.headers get a ws.headers JSON Schema', () => {
    const ch = doc.channels['chatRoom']!;
    const headers = ch.bindings?.ws?.headers;
    expect(headers).toBeDefined();
    expect(headers?.type).toBe('object');
    expect(headers?.properties?.['authorization']).toMatchObject({
      type: 'string',
    });
    expect(headers?.required).toContain('authorization');
  });

  it('channels with connection.query get a ws.query JSON Schema', () => {
    const ch = doc.channels['chatRoom']!;
    const query = ch.bindings?.ws?.query;
    expect(query).toBeDefined();
    expect(query?.properties?.['since']).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
  });

  it('channels with neither headers nor query omit bindings', () => {
    const router = createRouter({ title: 't', version: '1' });
    router.add(
      channel({
        name: 'bare',
        path: '/ws/bare',
        summary: 'Bare channel',
        clientMessages: {},
        serverMessages: {},
        handlers: {},
      }),
    );
    const d = generateAsyncAPI(router);
    expect(d.channels['bare']?.bindings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bounded contexts → tags
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — bounded contexts', () => {
  it('context descriptions become top-level tag descriptions', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'Chat',
      { description: 'Real-time messaging', models: [ChatMessage] },
      (ctx) => {
        ctx.add(chatRoom);
      },
    );
    const doc = generateAsyncAPI(router);
    expect(doc.tags).toContainEqual({
      name: 'Chat',
      description: 'Real-time messaging',
    });
  });

  it('channels in a context are auto-tagged with the context name on operations', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context('Chat', {}, (ctx) => ctx.add(chatRoom));
    const doc = generateAsyncAPI(router);
    const op = doc.operations['chatRoom.client.sendMessage']!;
    const tagNames = op.tags?.map((t) => t.name) ?? [];
    expect(tagNames).toContain('Chat');
    // explicit channel.tags still present
    expect(tagNames).toContain('Chat');
  });

  it('context auto-tag is also applied to the channel object', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context('Chat', {}, (ctx) => ctx.add(chatRoom));
    const doc = generateAsyncAPI(router);
    const tagNames = doc.channels['chatRoom']?.tags?.map((t) => t.name) ?? [];
    expect(tagNames).toContain('Chat');
  });
});

// ---------------------------------------------------------------------------
// Empty router
// ---------------------------------------------------------------------------

describe('generateAsyncAPI — empty router', () => {
  it('produces a valid document with empty channels and operations', () => {
    const router = createRouter({ title: 'empty', version: '0.0.0' });
    const doc = generateAsyncAPI(router);
    expect(doc.asyncapi).toBe('3.0.0');
    expect(doc.channels).toEqual({});
    expect(doc.operations).toEqual({});
    expect(doc.components.schemas).toEqual({});
    expect(doc.components.messages).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('serialize — YAML and JSON', () => {
  const doc = generateAsyncAPI(buildRouter());

  it('toYaml produces AsyncAPI-compatible YAML', () => {
    const yaml = toYaml(doc);
    expect(yaml).toContain('asyncapi: 3.0.0');
    expect(yaml).toContain('title: Chat API');
    expect(yaml).toContain('chatRoom:');
    expect(yaml).toContain('address: /ws/rooms/{roomId}');
  });

  it('toJson produces valid JSON', () => {
    const json = toJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed.asyncapi).toBe('3.0.0');
    expect(parsed.info.title).toBe('Chat API');
  });

  it('toJson round-trips through parse', () => {
    const json = toJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(doc);
  });
});
