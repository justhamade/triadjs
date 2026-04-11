/**
 * End-to-end post CRUD tests for the supabase-edge example.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  BOB,
  seedUser,
  startE2eServer,
  type E2eHarness,
} from './setup.js';

describe('supabase-edge posts e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /posts creates a post for the authenticated user', async () => {
    const token = seedUser(harness, ALICE);
    const response = await fetch(`${harness.baseUrl}/posts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: 'Hello', body: 'First post' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      title: string;
      authorId: string;
    };
    expect(body.title).toBe('Hello');
    expect(body.authorId).toBe(ALICE.id);
  });

  it('POST /posts returns 401 without a token', async () => {
    const response = await fetch(`${harness.baseUrl}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sneaky', body: 'Should never land' }),
    });
    expect(response.status).toBe(401);
  });

  it('GET /posts is public and returns created posts', async () => {
    await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'One',
      body: 'Body',
    });
    await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Two',
      body: 'Body',
    });
    const response = await fetch(`${harness.baseUrl}/posts?limit=10`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it('GET /posts/:id returns 200 for an existing post and 404 otherwise', async () => {
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Hi',
      body: 'World',
    });

    const okResp = await fetch(`${harness.baseUrl}/posts/${post.id}`);
    expect(okResp.status).toBe(200);
    const okBody = (await okResp.json()) as { title: string };
    expect(okBody.title).toBe('Hi');

    const missingResp = await fetch(
      `${harness.baseUrl}/posts/00000000-0000-0000-0000-000000000000`,
    );
    expect(missingResp.status).toBe(404);
  });

  it('PATCH /posts/:id returns 403 for non-authors', async () => {
    seedUser(harness, ALICE);
    const bobToken = seedUser(harness, BOB);
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Alice post',
      body: 'Body',
    });
    const response = await fetch(`${harness.baseUrl}/posts/${post.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(response.status).toBe(403);
  });

  it('DELETE /posts/:id returns 204 for the author', async () => {
    const token = seedUser(harness, ALICE);
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Doomed',
      body: 'Body',
    });
    const response = await fetch(`${harness.baseUrl}/posts/${post.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(204);
  });
});
