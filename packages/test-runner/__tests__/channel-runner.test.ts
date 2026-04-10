import { describe, expect, it, vi } from 'vitest';
import { createRouter, channel, scenario, t } from '@triad/core';
import type { ServiceContainer } from '@triad/core';
import { runChannelBehaviors } from '../src/channel-runner.js';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const ChatMessage = t.model('ChatMessage', {
  from: t.string(),
  text: t.string(),
});
const Typing = t.model('Typing', { user: t.string() });

// Test-only service that tracks per-room messages so we can assert
// `servicesFactory` isolation between scenarios.
class InMemoryRoomStore {
  readonly messages: string[] = [];
}

declare module '@triad/core' {
  interface ServiceContainer {
    rooms?: InMemoryRoomStore;
  }
}

// ---------------------------------------------------------------------------
// A chat channel with three behaviors
// ---------------------------------------------------------------------------

function buildChatChannel() {
  return channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Chat room',
    connection: { params: { roomId: t.string() } },
    clientMessages: {
      sendMessage: { schema: ChatMessage, description: 'Send chat' },
      startTyping: { schema: Typing, description: 'Typing indicator' },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'Message fan-out' },
      typing: { schema: Typing, description: 'Typing fan-out' },
    },
    onConnect: (ctx) => {
      // Refuse connections to the "locked" room so we can cover the
      // rejection path.
      if (
        typeof ctx.params === 'object' &&
        ctx.params !== null &&
        (ctx.params as { roomId?: string }).roomId === 'locked'
      ) {
        ctx.reject(401, 'room locked');
      }
    },
    handlers: {
      sendMessage: (ctx, data) => {
        ctx.services.rooms?.messages.push(data.text);
        ctx.broadcast.message(data);
      },
      startTyping: (ctx, data) => {
        ctx.broadcastOthers.typing(data);
      },
    },
    behaviors: [
      scenario('Clients see broadcasts for the room they joined')
        .given('a client in room r1')
        .params({ roomId: 'r1' })
        .body({ from: 'alice', text: 'hi' })
        .when('client sends sendMessage')
        .then('client receives a message event')
        .and('message has text "hi"'),

      scenario('Typing indicator does not echo to the sender')
        .given('a client in room r1')
        .params({ roomId: 'r1' })
        .body({ user: 'alice' })
        .when('client sends startTyping')
        .then('client does NOT receive a typing event'),

      scenario('Locked rooms reject connections')
        .given('the locked room')
        .params({ roomId: 'locked' })
        .when('client connects')
        .then('connection is rejected with code 401'),
    ],
  });
}

function buildRouter() {
  const router = createRouter({ title: 'Chat', version: '1' });
  router.add(buildChatChannel());
  return router;
}

function servicesFactory(): ServiceContainer {
  return { rooms: new InMemoryRoomStore() };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runChannelBehaviors — happy path', () => {
  it('runs every channel behavior and reports all passed', async () => {
    const summary = await runChannelBehaviors(buildRouter(), {
      servicesFactory,
    });
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(0);
  });

  it('result entries carry channel name and scenario', async () => {
    const summary = await runChannelBehaviors(buildRouter(), {
      servicesFactory,
    });
    const first = summary.results[0]!;
    expect(first.endpointName).toBe('chatRoom');
    expect(first.method).toBe('WS');
    expect(first.path).toBe('/ws/rooms/:roomId');
    expect(first.status).toBe('passed');
  });

  it('isolates scenarios via servicesFactory (fresh store each time)', async () => {
    const factory = vi.fn(servicesFactory);
    await runChannelBehaviors(buildRouter(), { servicesFactory: factory });
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Failure reporting
// ---------------------------------------------------------------------------

describe('runChannelBehaviors — failure reporting', () => {
  it('reports assertion failures without crashing', async () => {
    const ch = channel({
      name: 'wrong',
      path: '/ws/wrong',
      summary: 'w',
      clientMessages: {
        sendMessage: { schema: ChatMessage, description: 's' },
      },
      serverMessages: {
        message: { schema: ChatMessage, description: 'm' },
      },
      handlers: {
        sendMessage: (ctx, data) => ctx.broadcast.message(data),
      },
      behaviors: [
        scenario('Wrong expected message type')
          .given('a client')
          .body({ from: 'a', text: 'b' })
          .when('client sends sendMessage')
          .then('client receives a nonexistent event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const summary = await runChannelBehaviors(router);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.failure?.message).toMatch(/nonexistent/);
  });

  it('reports handler exceptions as errored', async () => {
    const ch = channel({
      name: 'boom',
      path: '/ws/boom',
      summary: 'b',
      clientMessages: {
        sendMessage: { schema: ChatMessage, description: 's' },
      },
      serverMessages: {
        message: { schema: ChatMessage, description: 'm' },
      },
      handlers: {
        sendMessage: () => {
          throw new Error('boom');
        },
      },
      behaviors: [
        scenario('Handler crashes')
          .given('a client')
          .body({ from: 'a', text: 'b' })
          .when('client sends sendMessage')
          .then('client receives a message event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const summary = await runChannelBehaviors(router);
    expect(summary.errored).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('runChannelBehaviors — teardown', () => {
  it('calls teardown for every scenario even on failure', async () => {
    const teardown = vi.fn();
    const ch = channel({
      name: 'tearCh',
      path: '/ws/tear',
      summary: 't',
      clientMessages: {
        sendMessage: { schema: ChatMessage, description: 's' },
      },
      serverMessages: {
        message: { schema: ChatMessage, description: 'm' },
      },
      handlers: {
        sendMessage: (ctx, data) => ctx.broadcast.message(data),
      },
      behaviors: [
        scenario('Passes')
          .given('a client')
          .body({ from: 'a', text: 'hi' })
          .when('client sends sendMessage')
          .then('client receives a message event'),
        scenario('Fails')
          .given('a client')
          .body({ from: 'a', text: 'hi' })
          .when('client sends sendMessage')
          .then('client receives a nonexistent event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    await runChannelBehaviors(router, { servicesFactory, teardown });
    expect(teardown).toHaveBeenCalledTimes(2);
  });
});
