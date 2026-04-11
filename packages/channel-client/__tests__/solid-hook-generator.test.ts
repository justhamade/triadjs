/**
 * Per-channel Solid hook emission tests.
 *
 * Mirrors `react-hook-generator.test.ts` with Solid idioms: factory
 * is named `create*Channel`, reactivity uses `Accessor<T>` + signals,
 * and `enabled` accepts either a boolean or an `Accessor<boolean>`.
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { emitChannelSolidHook } from '../src/solid-hook-generator.js';

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

describe('emitChannelSolidHook', () => {
  it('emits a file named <kebab>-solid.ts with a create*Channel factory', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.path).toBe('book-reviews-solid.ts');
    expect(out.hookName).toBe('createBookReviewsChannel');
  });

  it('imports solid-js, the solid-runtime, and the vanilla factory', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("from 'solid-js'");
    expect(out.contents).toContain("from './solid-runtime.js'");
    expect(out.contents).toContain("from './book-reviews.js'");
    expect(out.contents).toContain('createBookReviewsClient');
  });

  it('declares enabled as Accessor<boolean> | boolean', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('enabled?: Accessor<boolean> | boolean;');
  });

  it('emits a typed onXxx handler for each server message', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('onReview?: (payload: Review) => void;');
  });

  it('emits state/isOpen as Accessor<...>', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('state: Accessor<ChannelState>;');
    expect(out.contents).toContain('isOpen: Accessor<boolean>;');
  });

  it('emits a send surface for bidirectional channels', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain("send: BookReviewsClient['send'];");
  });

  it('emits only onXxx handlers (no send) for server-only channels', () => {
    const out = emitChannelSolidHook(
      buildServerOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onTick?:');
    expect(out.contents).not.toContain("send: TickerFeedClient['send']");
  });

  it('emits only send (no onXxx handlers) for client-only channels', () => {
    const out = emitChannelSolidHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain("send: CommandStreamClient['send'];");
    expect(out.contents).not.toMatch(/on[A-Z]\w*\?:\s*\(payload:/);
  });

  it('routes onError to the domain error message when the channel declares one', () => {
    const out = emitChannelSolidHook(
      buildChannelWithErrorMessage(),
      new TypeEmitter(),
    );
    expect(out.contents).toContain('onError?: (payload: ChannelError) => void');
    expect(out.contents).toContain(
      "`onError` delivers the channel's `error` server message",
    );
  });

  it('creates the client via createTriadChannelLifecycle', () => {
    const out = emitChannelSolidHook(buildBidiChannel(), new TypeEmitter());
    expect(out.contents).toContain('createTriadChannelLifecycle(');
    expect(out.contents).toContain('createBookReviewsClient(clientOptions)');
  });

  it('emits camelCase → PascalCase factory names', () => {
    const out = emitChannelSolidHook(
      buildClientOnlyChannel(),
      new TypeEmitter(),
    );
    expect(out.hookName).toBe('createCommandStreamChannel');
    expect(out.contents).toContain('export function createCommandStreamChannel');
  });
});
