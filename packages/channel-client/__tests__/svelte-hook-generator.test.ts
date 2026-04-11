/**
 * Per-channel Svelte hook emission tests.
 *
 * Mirrors `react-hook-generator.test.ts` with Svelte idioms: factory
 * is named `<camel>Channel` (no `use`/`create` prefix), reactivity
 * uses `Readable` stores, and `enabled` is a plain boolean (Svelte
 * scripts decide at component-mount time).
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { emitChannelSvelteHook } from '../src/svelte-hook-generator.js';

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

describe('emitChannelSvelteHook', () => {
  it('emits a file named <kebab>-svelte.ts with a camelCase factory', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.path).toBe('book-reviews-svelte.ts');
    expect(out.hookName).toBe('bookReviewsChannel');
  });

  it('imports svelte, svelte/store, and the vanilla factory', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("from 'svelte'");
    expect(out.contents).toContain("from 'svelte/store'");
    expect(out.contents).toContain("from './svelte-runtime.js'");
    expect(out.contents).toContain("from './book-reviews.js'");
    expect(out.contents).toContain('createBookReviewsClient');
  });

  it('declares enabled as plain boolean', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('enabled?: boolean;');
  });

  it('emits a typed onXxx handler for each server message', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('onReview?: (payload: Review) => void;');
  });

  it('emits state/isOpen as Readable stores', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('state: Readable<ChannelState>;');
    expect(out.contents).toContain('isOpen: Readable<boolean>;');
  });

  it('emits a send surface for bidirectional channels', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("send: BookReviewsClient['send'];");
  });

  it('emits only onXxx handlers (no send) for server-only channels', () => {
    const out = emitChannelSvelteHook(
      buildServerOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onTick?:');
    expect(out.contents).not.toContain("send: TickerFeedClient['send']");
  });

  it('emits only send (no onXxx handlers) for client-only channels', () => {
    const out = emitChannelSvelteHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain("send: CommandStreamClient['send'];");
    expect(out.contents).not.toMatch(/on[A-Z]\w*\?:\s*\(payload:/);
  });

  it('routes onError to the domain error message when the channel declares one', () => {
    const out = emitChannelSvelteHook(
      buildChannelWithErrorMessage(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onError?: (payload: ChannelError) => void');
    expect(out.contents).toContain(
      "`onError` delivers the channel's `error` server message",
    );
  });

  it('creates the client via triadChannelLifecycle', () => {
    const out = emitChannelSvelteHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('triadChannelLifecycle(');
    expect(out.contents).toContain('createBookReviewsClient(clientOptions)');
  });

  it('emits lowercase-first factory name from camelCase channel name', () => {
    const out = emitChannelSvelteHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.hookName).toBe('commandStreamChannel');
    expect(out.contents).toContain('export function commandStreamChannel');
  });
});
