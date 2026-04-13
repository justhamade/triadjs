/**
 * Unit tests for the shared hook-analysis module.
 *
 * Verifies the extracted name-conversion, type-reference-collection,
 * and channel-analysis utilities that are consumed by all four
 * framework hook generators.
 */

import { describe, it, expect } from 'vitest';
import { channel, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import {
  toPascalCase,
  toCamelCase,
  toKebabCase,
  messageToHandlerName,
  collectTypeRefs,
  analyzeChannel,
  BUILTIN,
} from '../src/hook-analysis.js';

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

describe('toPascalCase', () => {
  it('converts camelCase to PascalCase', () => {
    expect(toPascalCase('bookReviews')).toBe('BookReviews');
  });

  it('converts kebab-case to PascalCase', () => {
    expect(toPascalCase('book-reviews')).toBe('BookReviews');
  });

  it('converts snake_case to PascalCase', () => {
    expect(toPascalCase('book_reviews')).toBe('BookReviews');
  });

  it('handles single word', () => {
    expect(toPascalCase('ticker')).toBe('Ticker');
  });
});

describe('toCamelCase', () => {
  it('converts to lowercase-first PascalCase', () => {
    expect(toCamelCase('book-reviews')).toBe('bookReviews');
  });

  it('lowercases the first letter of a PascalCase-like input', () => {
    expect(toCamelCase('BookReviews')).toBe('bookReviews');
  });
});

describe('toKebabCase', () => {
  it('converts camelCase to kebab-case', () => {
    expect(toKebabCase('bookReviews')).toBe('book-reviews');
  });

  it('converts PascalCase boundary', () => {
    expect(toKebabCase('BookReviews')).toBe('book-reviews');
  });
});

describe('messageToHandlerName', () => {
  it('prefixes with "on" and PascalCases the message type', () => {
    expect(messageToHandlerName('review')).toBe('onReview');
  });

  it('handles multi-word camelCase', () => {
    expect(messageToHandlerName('submitReview')).toBe('onSubmitReview');
  });

  it('handles "error" message type', () => {
    expect(messageToHandlerName('error')).toBe('onError');
  });
});

describe('collectTypeRefs', () => {
  it('extracts PascalCase type references', () => {
    const out = new Set<string>();
    collectTypeRefs('Review', out);
    expect(out).toEqual(new Set(['Review']));
  });

  it('ignores built-in types', () => {
    const out = new Set<string>();
    collectTypeRefs('Array<Review>', out);
    expect(out).toEqual(new Set(['Review']));
    expect(out.has('Array')).toBe(false);
  });

  it('collects multiple references from a compound type', () => {
    const out = new Set<string>();
    collectTypeRefs('Record<string, Review> | ChannelError', out);
    expect(out).toEqual(new Set(['Review', 'ChannelError']));
  });

  it('returns empty for primitive-only types', () => {
    const out = new Set<string>();
    collectTypeRefs('string | number | boolean', out);
    expect(out.size).toBe(0);
  });

  it('does not include any BUILTIN entries', () => {
    const out = new Set<string>();
    const builtinStr = Array.from(BUILTIN).join(' | ');
    collectTypeRefs(builtinStr, out);
    expect(out.size).toBe(0);
  });
});

describe('analyzeChannel', () => {
  it('produces correct pascal, camel, and kebab names', () => {
    const ch = channel({
      name: 'bookReviews',
      path: '/ws/reviews',
      summary: 'Reviews',
      connection: {},
      clientMessages: {},
      serverMessages: {
        review: { schema: Review, description: 'A review' },
      },
      handlers: {},
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.pascal).toBe('BookReviews');
    expect(result.camel).toBe('bookReviews');
    expect(result.kebab).toBe('book-reviews');
  });

  it('populates clientMessages and serverMessages', () => {
    const ch = channel({
      name: 'bookReviews',
      path: '/ws/reviews',
      summary: 'Reviews',
      connection: { params: { bookId: t.string() } },
      clientMessages: {
        submitReview: { schema: SubmitReview, description: 'Post' },
      },
      serverMessages: {
        review: { schema: Review, description: 'A review' },
      },
      handlers: {
        submitReview: () => {},
      },
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.clientMessages).toHaveLength(1);
    expect(result.clientMessages[0]!.type).toBe('submitReview');
    expect(result.serverMessages).toHaveLength(1);
    expect(result.serverMessages[0]!.type).toBe('review');
    expect(result.hasClientMessages).toBe(true);
    expect(result.hasServerMessages).toBe(true);
  });

  it('sets hasErrorMessage when server declares an error message', () => {
    const ch = channel({
      name: 'bookReviews',
      path: '/ws/reviews',
      summary: 'Reviews with error',
      connection: {},
      clientMessages: {},
      serverMessages: {
        review: { schema: Review, description: 'A review' },
        error: { schema: ChannelError, description: 'Domain error' },
      },
      handlers: {},
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.hasErrorMessage).toBe(true);
  });

  it('sets hasErrorMessage to false when no error server message', () => {
    const ch = channel({
      name: 'tickerFeed',
      path: '/ws/ticker',
      summary: 'Ticker',
      connection: {},
      clientMessages: {},
      serverMessages: {
        tick: { schema: Review, description: 'A tick' },
      },
      handlers: {},
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.hasErrorMessage).toBe(false);
  });

  it('returns empty clientMessages for server-only channels', () => {
    const ch = channel({
      name: 'tickerFeed',
      path: '/ws/ticker',
      summary: 'Ticker',
      connection: {},
      clientMessages: {},
      serverMessages: {
        tick: { schema: Review, description: 'A tick' },
      },
      handlers: {},
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.clientMessages).toHaveLength(0);
    expect(result.hasClientMessages).toBe(false);
  });

  it('collects type imports from connection params and messages', () => {
    const ch = channel({
      name: 'bookReviews',
      path: '/ws/reviews',
      summary: 'Reviews',
      connection: { params: { bookId: t.string() } },
      clientMessages: {
        submitReview: { schema: SubmitReview, description: 'Post' },
      },
      serverMessages: {
        review: { schema: Review, description: 'A review' },
      },
      handlers: {
        submitReview: () => {},
      },
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    expect(result.typeImports).toContain('Review');
    expect(result.typeImports).toContain('SubmitReview');
    // typeImports should be sorted
    const sorted = [...result.typeImports].sort();
    expect(result.typeImports).toEqual(sorted);
  });

  it('returns sorted typeImports', () => {
    const ch = channel({
      name: 'bookReviews',
      path: '/ws/reviews',
      summary: 'Reviews',
      connection: {},
      clientMessages: {
        submitReview: { schema: SubmitReview, description: 'Post' },
      },
      serverMessages: {
        review: { schema: Review, description: 'A review' },
        error: { schema: ChannelError, description: 'Error' },
      },
      handlers: {
        submitReview: () => {},
      },
    });
    const result = analyzeChannel(ch, new TypeEmitter());
    const sorted = [...result.typeImports].sort();
    expect(result.typeImports).toEqual(sorted);
  });
});
