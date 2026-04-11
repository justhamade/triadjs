/**
 * End-to-end book CRUD tests for the bookshelf example.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('bookshelf books e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /books adds a book to the user’s shelf', async () => {
    const { token } = await seedUser(harness);
    const response = await fetch(`${harness.baseUrl}/books`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: 'The Pragmatic Programmer',
        author: 'Andy Hunt',
        publishedYear: 1999,
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { title: string };
    expect(body.title).toBe('The Pragmatic Programmer');
  });

  it('GET /books returns only the caller’s books', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    await harness.services.bookRepo.create({
      ownerId: alice.userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    await harness.services.bookRepo.create({
      ownerId: bob.userId,
      title: 'Neuromancer',
      author: 'William Gibson',
      publishedYear: 1984,
    });

    const response = await fetch(`${harness.baseUrl}/books?limit=20`, {
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ title: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.title).toBe('Dune');
  });

  it('GET /books/:id returns 200 for the owner, 403 for others', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    const book = await harness.services.bookRepo.create({
      ownerId: alice.userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });

    const aliceResp = await fetch(`${harness.baseUrl}/books/${book.id}`, {
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(aliceResp.status).toBe(200);

    const bobResp = await fetch(`${harness.baseUrl}/books/${book.id}`, {
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(bobResp.status).toBe(403);
    const errBody = (await bobResp.json()) as { code: string };
    expect(errBody.code).toBe('FORBIDDEN');
  });

  it('PATCH /books/:id updates a book the user owns', async () => {
    const { token, userId } = await seedUser(harness);
    const book = await harness.services.bookRepo.create({
      ownerId: userId,
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      publishedYear: 1937,
    });
    const response = await fetch(`${harness.baseUrl}/books/${book.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: 'The Hobbit (Illustrated)' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { title: string };
    expect(body.title).toBe('The Hobbit (Illustrated)');
  });

  it('DELETE /books/:id returns 204', async () => {
    const { token, userId } = await seedUser(harness);
    const book = await harness.services.bookRepo.create({
      ownerId: userId,
      title: 'Ephemeral',
      author: 'Nobody',
      publishedYear: 2020,
    });
    const response = await fetch(`${harness.baseUrl}/books/${book.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(204);
  });

  it('GET /books/:id returns 404 for an unknown id', async () => {
    const { token } = await seedUser(harness);
    const response = await fetch(
      `${harness.baseUrl}/books/00000000-0000-0000-0000-000000000000`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(404);
  });
});
