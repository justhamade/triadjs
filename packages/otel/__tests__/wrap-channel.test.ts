import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter, channel, t } from '@triad/core';
import { SpanStatusCode } from '@opentelemetry/api';
import { withOtelInstrumentation } from '../src/index.js';
import { createOtelHarness, type OtelTestHarness } from './test-helpers.js';

const ChatMessage = t.model('ChatMessage', {
  text: t.string(),
  userId: t.string(),
});

function makeChannel() {
  return channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Chat room',
    clientMessages: {
      message: { schema: ChatMessage, description: 'Client sends message' },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'Server broadcasts message' },
    },
    onConnect: async () => {
      /* noop */
    },
    handlers: {
      message: async () => {
        /* noop */
      },
    },
  });
}

describe('withOtelInstrumentation — channel wrapping', () => {
  let harness: OtelTestHarness;
  beforeEach(() => {
    harness = createOtelHarness();
    harness.reset();
  });

  it('wraps channel.handlers[msgType] with a span', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeChannel());
    withOtelInstrumentation(router);

    const ch = router.allChannels()[0]!;
    await ch.handlers['message']!({ state: {} }, { text: 'hi', userId: '1' });

    const spans = harness.spans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe('chatRoom.message');
    expect(span.attributes['triad.channel.name']).toBe('chatRoom');
    expect(span.attributes['triad.channel.message.type']).toBe('message');
    expect(span.attributes['triad.channel.direction']).toBe('client');
  });

  it('wraps channel.onConnect with a span', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeChannel());
    withOtelInstrumentation(router);

    const ch = router.allChannels()[0]!;
    await ch.onConnect!({ state: {} });
    const span = harness.spans()[0]!;
    expect(span.name).toBe('chatRoom.onConnect');
    expect(span.attributes['triad.channel.name']).toBe('chatRoom');
  });

  it('records exceptions thrown from a channel handler', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      channel({
        name: 'chatRoom',
        path: '/ws',
        summary: 'x',
        clientMessages: {
          message: { schema: ChatMessage, description: 'c' },
        },
        serverMessages: {
          message: { schema: ChatMessage, description: 's' },
        },
        handlers: {
          message: async () => {
            throw new Error('handler-broken');
          },
        },
      }),
    );
    withOtelInstrumentation(router);

    const ch = router.allChannels()[0]!;
    await expect(
      ch.handlers['message']!({ state: {} }, { text: 'x', userId: '1' }),
    ).rejects.toThrow('handler-broken');
    const span = harness.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('records exceptions thrown from onConnect', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      channel({
        name: 'chatRoom',
        path: '/ws',
        summary: 'x',
        clientMessages: {
          message: { schema: ChatMessage, description: 'c' },
        },
        serverMessages: {
          message: { schema: ChatMessage, description: 's' },
        },
        onConnect: async () => {
          throw new Error('connect-broken');
        },
        handlers: { message: async () => undefined },
      }),
    );
    withOtelInstrumentation(router);

    await expect(
      router.allChannels()[0]!.onConnect!({ state: {} }),
    ).rejects.toThrow('connect-broken');
    const span = harness.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('skips channel wrapping when instrumentChannels is false', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    const original = makeChannel();
    router.add(original);
    const originalHandler = original.handlers['message'];
    withOtelInstrumentation(router, { instrumentChannels: false });
    expect(router.allChannels()[0]!.handlers['message']).toBe(originalHandler);
  });
});
