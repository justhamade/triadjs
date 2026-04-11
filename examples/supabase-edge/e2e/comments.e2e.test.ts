/**
 * End-to-end comment tests — commenting is nested under a post and
 * does NOT require post ownership.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  BOB,
  seedUser,
  startE2eServer,
  type E2eHarness,
} from './setup.js';

describe('supabase-edge comments e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('any authenticated user can comment on any post', async () => {
    seedUser(harness, ALICE);
    const bobToken = seedUser(harness, BOB);
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Alice post',
      body: 'Body',
    });
    const response = await fetch(
      `${harness.baseUrl}/posts/${post.id}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ body: 'Nice post!' }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      body: string;
      authorId: string;
    };
    expect(body.body).toBe('Nice post!');
    expect(body.authorId).toBe(BOB.id);
  });

  it('commenting on a missing post returns 404', async () => {
    const token = seedUser(harness, ALICE);
    const response = await fetch(
      `${harness.baseUrl}/posts/00000000-0000-0000-0000-000000000000/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: 'Hello?' }),
      },
    );
    expect(response.status).toBe(404);
  });

  it('commenting without auth returns 401', async () => {
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Open',
      body: 'Body',
    });
    const response = await fetch(
      `${harness.baseUrl}/posts/${post.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Anon' }),
      },
    );
    expect(response.status).toBe(401);
  });

  it('GET /posts/:id/comments is public and returns seeded comments', async () => {
    const post = await harness.services.postRepo.create({
      authorId: ALICE.id,
      title: 'Thread',
      body: 'Body',
    });
    await harness.services.commentRepo.create({
      postId: post.id,
      authorId: BOB.id,
      body: 'First',
    });
    await harness.services.commentRepo.create({
      postId: post.id,
      authorId: ALICE.id,
      body: 'Second',
    });
    const response = await fetch(`${harness.baseUrl}/posts/${post.id}/comments`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ body: string }>;
    expect(body).toHaveLength(2);
  });
});
