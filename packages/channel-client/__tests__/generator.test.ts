/**
 * Top-level generator tests — exercise the file list and the
 * presence of key strings against a small in-memory router.
 */

import { describe, it, expect } from 'vitest';
import { channel, createRouter, t } from '@triadjs/core';
import { generateChannelClient } from '../src/generator.js';

const ChatMessage = t.model('ChatMessage', {
  userId: t.string(),
  text: t.string().minLength(1),
});

const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string(),
  isTyping: t.boolean(),
});

function buildRouter() {
  const chat = channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Chat room',
    connection: {
      params: { roomId: t.string() },
      headers: { authorization: t.string() },
    },
    clientMessages: {
      sendMessage: {
        schema: t.model('SendMessagePayload', { text: t.string().minLength(1) }),
        description: 'Send a chat message',
      },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'New message' },
      typing: { schema: TypingIndicator, description: 'Typing update' },
    },
    handlers: {
      sendMessage: () => {},
    },
  });
  const notif = channel({
    name: 'notifications',
    path: '/ws/notifications',
    summary: 'Global notifications',
    clientMessages: {
      ack: {
        schema: t.model('AckPayload', { id: t.string() }),
        description: 'Ack a notification',
      },
    },
    serverMessages: {
      notify: {
        schema: t.model('NotifyPayload', { title: t.string() }),
        description: 'A notification',
      },
    },
    handlers: { ack: () => {} },
  });
  const router = createRouter({ title: 'T', version: '1' });
  router.add(chat, notif);
  return router;
}

describe('generateChannelClient', () => {
  it('returns an empty list when the router has no channels', () => {
    const router = createRouter({ title: 'Empty', version: '1' });
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    expect(files).toEqual([]);
  });

  it('emits types.ts, index.ts, client.ts, and one file per channel', () => {
    const router = buildRouter();
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('types.ts');
    expect(paths).toContain('index.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('chat-room.ts');
    expect(paths).toContain('notifications.ts');
  });

  it('omits client.ts when emitRuntime is false', () => {
    const router = buildRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      emitRuntime: false,
    });
    expect(files.some((f) => f.path === 'client.ts')).toBe(false);
  });

  it('registers every named server-message model into types.ts', () => {
    const router = buildRouter();
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    const types = files.find((f) => f.path === 'types.ts')!.contents;
    expect(types).toContain('export interface ChatMessage {');
    expect(types).toContain('export interface TypingIndicator {');
    expect(types).toContain('export interface SendMessagePayload {');
    expect(types).toContain('export interface NotifyPayload {');
  });

  it('index.ts re-exports every channel file', () => {
    const router = buildRouter();
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    const index = files.find((f) => f.path === 'index.ts')!.contents;
    expect(index).toContain("export * from './chat-room.js';");
    expect(index).toContain("export * from './notifications.js';");
    expect(index).toContain("export * from './client.js';");
    expect(index).toContain("export * from './types.js';");
  });
});
