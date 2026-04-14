/**
 * Per-channel React hook emission tests.
 *
 * Mirrors the vanilla `channel-generator.test.ts`, but asserts on the
 * shape of the React hook file (imports, options interface, event
 * callbacks, and the collision handling for a channel that declares a
 * `serverMessages.error`).
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triadjs/core';
import { TypeEmitter } from '@triadjs/tanstack-query';
import { emitChannelReactHook } from '../src/react-hook-generator.js';

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
    handlers: {
      submitReview: () => {},
    },
  });
}

function buildServerOnlyChannel() {
  return channel({
    name: 'tickerFeed',
    path: '/ws/ticker',
    summary: 'Ticker feed',
    connection: {},
    clientMessages: {},
    serverMessages: {
      tick: { schema: Review, description: 'A tick' },
    },
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
    handlers: {
      issue: () => {},
    },
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
    handlers: {
      submitReview: () => {},
    },
  });
}

describe('emitChannelReactHook', () => {
  it('emits a file named <kebab>-react.ts', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.path).toBe('book-reviews-react.ts');
    expect(out.hookName).toBe('useBookReviewsChannel');
  });

  it('imports react, the react-runtime, and the vanilla channel factory', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("from 'react'");
    expect(out.contents).toContain("from './react-runtime.js'");
    expect(out.contents).toContain("from './book-reviews.js'");
    expect(out.contents).toContain('createBookReviewsClient');
  });

  it('emits a UseBookReviewsChannelOptions interface extending the client options', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain(
      'export interface UseBookReviewsChannelOptions',
    );
    expect(out.contents).toContain('extends BookReviewsClientOptions');
    expect(out.contents).toContain('enabled?: boolean;');
  });

  it('emits a typed onXxx handler for each server message', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('onReview?: (payload: Review) => void;');
  });

  it('emits a send surface for bidirectional channels', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("send: BookReviewsClient['send'];");
  });

  it('emits only onXxx handlers (no send) for server-only channels', () => {
    const out = emitChannelReactHook(
      buildServerOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onTick?:');
    expect(out.contents).not.toContain("send: TickerFeedClient['send']");
  });

  it('emits only send (no onXxx handlers) for client-only channels', () => {
    const out = emitChannelReactHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain("send: CommandStreamClient['send'];");
    // No server messages, so no onXxx
    expect(out.contents).not.toMatch(/on[A-Z]\w*\?:\s*\(payload:/);
  });

  it('routes onError to the domain error message when the channel declares one', () => {
    const out = emitChannelReactHook(
      buildChannelWithErrorMessage(),
      new TypeEmitter(),
    );
    // When `error` is a server message, `onError` is its typed callback.
    expect(out.contents).toContain('onError?: (payload: ChannelError) => void');
    // The generated comment documents the collision resolution.
    expect(out.contents).toContain(
      "`onError` delivers the channel's `error` server message",
    );
  });

  it('calls createBookReviewsClient once per mount via useTriadChannelLifecycle', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('useTriadChannelLifecycle(');
    expect(out.contents).toContain('createBookReviewsClient(clientOptions)');
  });

  it('subscribes to each onXxx callback inside its own useEffect', () => {
    const out = emitChannelReactHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("client.on('review', onReview)");
  });

  it('emits camelCase → PascalCase hook names', () => {
    const out = emitChannelReactHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.hookName).toBe('useCommandStreamChannel');
    expect(out.contents).toContain(
      'export function useCommandStreamChannel',
    );
  });
});
