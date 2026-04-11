/**
 * Per-channel emission tests — assert shapes, factories, typed
 * overloads, and URL interpolation.
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { emitChannelClient } from '../src/channel-generator.js';

function buildChannel() {
  const Review = t.model('Review', {
    id: t.string(),
    rating: t.int32(),
    comment: t.string(),
  });
  const SubmitReview = t.model('SubmitReview', {
    rating: t.int32(),
    comment: t.string(),
  });
  return channel({
    name: 'bookReviews',
    path: '/ws/books/:bookId/reviews',
    summary: 'Book reviews',
    connection: {
      params: { bookId: t.string() },
      headers: { authorization: t.string() },
    },
    clientMessages: {
      submitReview: {
        schema: SubmitReview,
        description: 'Post a new review',
      },
    },
    serverMessages: {
      review: { schema: Review, description: 'A new review' },
    },
    handlers: {
      submitReview: () => {},
    },
  });
}

describe('emitChannelClient', () => {
  it('produces a kebab-case file name from the PascalCase base', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.path).toBe('book-reviews.ts');
    expect(out.baseName).toBe('BookReviews');
  });

  it('emits connection params, query, and headers interfaces', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.contents).toContain(
      'export interface BookReviewsConnectionParams {',
    );
    expect(out.contents).toContain('bookId: string;');
    expect(out.contents).toContain('export interface BookReviewsHeaders {');
    expect(out.contents).toContain('authorization: string;');
    expect(out.contents).toContain('export interface BookReviewsQuery {');
  });

  it('emits a typed send map for every client message', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.contents).toContain('export interface BookReviewsSendMap {');
    expect(out.contents).toContain('submitReview(payload: SubmitReview): void;');
  });

  it('emits typed on() overloads for each server message and for lifecycle events', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.contents).toContain(
      'on(event: "review", cb: (payload: Review) => void): () => void;',
    );
    expect(out.contents).toContain(
      "on(event: 'stateChange'",
    );
    expect(out.contents).toContain("on(event: 'open'");
    expect(out.contents).toContain("on(event: 'close'");
    expect(out.contents).toContain("on(event: 'error'");
  });

  it('interpolates path parameters into the URL template', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.contents).toContain(
      '${encodeURIComponent(String(params.bookId))}',
    );
  });

  it('emits a createBookReviewsClient factory', () => {
    const ch = buildChannel();
    const emitter = new TypeEmitter();
    const out = emitChannelClient(ch, emitter);
    expect(out.contents).toContain(
      'export function createBookReviewsClient(options: BookReviewsClientOptions): BookReviewsClient {',
    );
  });
});
