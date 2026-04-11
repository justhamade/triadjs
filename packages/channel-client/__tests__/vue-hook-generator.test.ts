/**
 * Per-channel Vue hook emission tests.
 *
 * Mirrors `react-hook-generator.test.ts` with Vue Composition API
 * idioms: hook is named `use*Channel`, reactivity uses `Ref`/
 * `ComputedRef`, and `enabled` accepts either a boolean or a
 * `Ref<boolean>`.
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { emitChannelVueHook } from '../src/vue-hook-generator.js';

const Review = t.model('Review', {
  id: t.string(),
  rating: t.int32(),
  comment: t.string(),
});
const SubmitReview = t.model('SubmitReview', {
  rating: t.int32(),
  comment: t.string(),
});
const ChannelError = t.model('ChannelError', {
  code: t.string(),
  message: t.string(),
});

function buildBidiChannel() {
  return channel({
    name: 'bookReviews',
    path: '/ws/books/:bookId/reviews',
    summary: 'Book reviews',
    connection: {
      params: { bookId: t.string() },
      headers: { authorization: t.string() },
    },
    clientMessages: {
      submitReview: { schema: SubmitReview, description: 'Post' },
    },
    serverMessages: {
      review: { schema: Review, description: 'A new review' },
    },
    handlers: { submitReview: () => {} },
  });
}

function buildServerOnlyChannel() {
  return channel({
    name: 'tickerFeed',
    path: '/ws/ticker',
    summary: 'Ticker feed',
    connection: {},
    clientMessages: {},
    serverMessages: { tick: { schema: Review, description: 'A tick' } },
    handlers: {},
  });
}

function buildClientOnlyChannel() {
  return channel({
    name: 'commandStream',
    path: '/ws/commands',
    summary: 'Command stream',
    connection: {},
    clientMessages: {
      issue: { schema: SubmitReview, description: 'Issue a command' },
    },
    serverMessages: {},
    handlers: { issue: () => {} },
  });
}

function buildChannelWithErrorMessage() {
  return channel({
    name: 'bookReviews',
    path: '/ws/books/:bookId/reviews',
    summary: 'Book reviews with error message',
    connection: { params: { bookId: t.string() } },
    clientMessages: {
      submitReview: { schema: SubmitReview, description: 'Post' },
    },
    serverMessages: {
      review: { schema: Review, description: 'A new review' },
      error: { schema: ChannelError, description: 'Domain error' },
    },
    handlers: { submitReview: () => {} },
  });
}

describe('emitChannelVueHook', () => {
  it('emits a file named <kebab>-vue.ts with a use*Channel hook', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.path).toBe('book-reviews-vue.ts');
    expect(out.hookName).toBe('useBookReviewsChannel');
  });

  it('imports vue, the vue-runtime, and the vanilla factory', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("from 'vue'");
    expect(out.contents).toContain("from './vue-runtime.js'");
    expect(out.contents).toContain("from './book-reviews.js'");
    expect(out.contents).toContain('createBookReviewsClient');
  });

  it('declares enabled as Ref<boolean> | boolean', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('enabled?: Ref<boolean> | boolean;');
  });

  it('emits a typed onXxx handler for each server message', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('onReview?: (payload: Review) => void;');
  });

  it('emits state as Ref and isOpen as ComputedRef', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('state: Ref<ChannelState>;');
    expect(out.contents).toContain('isOpen: ComputedRef<boolean>;');
  });

  it('emits a send surface for bidirectional channels', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("send: BookReviewsClient['send'];");
  });

  it('emits only onXxx handlers (no send) for server-only channels', () => {
    const out = emitChannelVueHook(buildServerOnlyChannel(), new TypeEmitter());
    expect(out.contents).toContain('onTick?:');
    expect(out.contents).not.toContain("send: TickerFeedClient['send']");
  });

  it('emits only send (no onXxx handlers) for client-only channels', () => {
    const out = emitChannelVueHook(buildClientOnlyChannel(), new TypeEmitter());
    expect(out.contents).toContain("send: CommandStreamClient['send'];");
    expect(out.contents).not.toMatch(/on[A-Z]\w*\?:\s*\(payload:/);
  });

  it('routes onError to the domain error message when the channel declares one', () => {
    const out = emitChannelVueHook(
      buildChannelWithErrorMessage(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onError?: (payload: ChannelError) => void');
    expect(out.contents).toContain(
      "`onError` delivers the channel's `error` server message",
    );
  });

  it('creates the client via useTriadChannelLifecycle', () => {
    const out = emitChannelVueHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('useTriadChannelLifecycle(');
    expect(out.contents).toContain('createBookReviewsClient(clientOptions)');
  });

  it('emits camelCase → PascalCase hook names', () => {
    const out = emitChannelVueHook(buildClientOnlyChannel(), new TypeEmitter());
    expect(out.hookName).toBe('useCommandStreamChannel');
    expect(out.contents).toContain('export function useCommandStreamChannel');
  });
});
