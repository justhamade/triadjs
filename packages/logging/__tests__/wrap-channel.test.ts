import { describe, it, expect } from 'vitest';
import { createRouter, channel, t } from '@triadjs/core';
import {
  withLoggingInstrumentation,
  getLogger,
} from '../src/index.js';
import { FakeLogger } from './fake-logger.js';

const ChatMessage = t.model('ChatMessage', {
  text: t.string(),
  userId: t.string(),
});

describe('withLoggingInstrumentation — channel wrapping', () => {
  it('makes getLogger() inside channel handler have triad.channel.* context', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      channel({
        name: 'chatRoom',
        path: '/ws/rooms/:roomId',
        summary: 'Chat',
        clientMessages: {
          message: { schema: ChatMessage, description: 'c' },
        },
        serverMessages: {
          message: { schema: ChatMessage, description: 's' },
        },
        handlers: {
          message: async () => {
            getLogger().info('inside');
          },
        },
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    const ch = router.allChannels()[0]!;
    await ch.handlers['message']!({ state: {} }, { text: 'hi', userId: '1' });

    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['triad.channel.name']).toBe('chatRoom');
    expect(inside.context['triad.channel.message.type']).toBe('message');
  });

  it('makes getLogger() inside onConnect have triad.channel.name and onConnect marker', async () => {
    const base = new FakeLogger();
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
          getLogger().info('connected');
        },
        handlers: { message: async () => undefined },
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    await router.allChannels()[0]!.onConnect!({ state: {} });
    const inside = base.calls.find((c) => c.message === 'connected')!;
    expect(inside.context['triad.channel.name']).toBe('chatRoom');
    expect(inside.context['triad.channel.message.type']).toBe('onConnect');
  });

  it('instrumentChannels: false leaves channel handlers alone', () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    const ch = channel({
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
        message: async () => undefined,
      },
    });
    router.add(ch);
    const originalHandler = ch.handlers['message'];
    withLoggingInstrumentation(router, {
      logger: base,
      instrumentChannels: false,
    });
    expect(router.allChannels()[0]!.handlers['message']).toBe(originalHandler);
  });
});
