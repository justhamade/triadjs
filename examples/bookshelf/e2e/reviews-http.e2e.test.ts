/**
 * End-to-end HTTP tests for the Reviews context.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('bookshelf reviews HTTP e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /books/:id/reviews creates a review when the caller owns the book', async () => {
    const { token, userId } = await seedUser(harness);
    const book = await harness.services.bookRepo.create({
      ownerId: userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    const response = await fetch(
      `${harness.baseUrl}/books/${book.id}/reviews`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rating: { score: 5 },
          comment: 'A masterpiece.',
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      comment: string;
      rating: { score: number };
    };
    expect(body.comment).toBe('A masterpiece.');
    expect(body.rating.score).toBe(5);
  });

  it('returns 403 when reviewing someone else’s book', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    const book = await harness.services.bookRepo.create({
      ownerId: alice.userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    const response = await fetch(
      `${harness.baseUrl}/books/${book.id}/reviews`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bob.token}`,
        },
        body: JSON.stringify({
          rating: { score: 1 },
          comment: 'Sneaky review.',
        }),
      },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 404 for an unknown book id', async () => {
    const { token } = await seedUser(harness);
    const response = await fetch(
      `${harness.baseUrl}/books/00000000-0000-0000-0000-000000000000/reviews`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating: { score: 3 }, comment: 'Hi' }),
      },
    );
    expect(response.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const response = await fetch(
      `${harness.baseUrl}/books/00000000-0000-0000-0000-000000000000/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: { score: 3 }, comment: 'Hi' }),
      },
    );
    expect(response.status).toBe(401);
  });
});
