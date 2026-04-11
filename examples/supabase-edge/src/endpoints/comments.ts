/**
 * Comment endpoints.
 *
 * Commenting is a two-step authorization:
 *
 *   1. `requireAuth` — you must be logged in to comment.
 *   2. The parent post must exist (or we 404 the request).
 *
 * But ANY authenticated user may comment on ANY post — there is no
 * ownership check on the parent post. Contrast with tasks in the
 * tasktracker example, where a task could only be created inside a
 * project the caller already owned. That difference is the whole
 * reason this bounded context exists in the example: it exercises
 * a different authorization shape.
 *
 * Listing comments on a post is PUBLIC (mirroring `listPosts`) —
 * anyone can read them without authenticating. This lets the
 * example demonstrate mixing authed and unauthed endpoints inside
 * the same bounded context.
 */

import { endpoint, scenario, t } from '@triad/core';
import { Comment, CreateComment } from '../schemas/comment.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../supabase-auth.js';
import type { MemoryAuthVerifier } from '../auth-verifier.js';

const ALICE = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  name: 'Alice',
} as const;

const BOB = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
  name: 'Bob',
} as const;

function seedUser(
  services: { authVerifier: unknown },
  opts: { id: string; email: string; name: string },
): string {
  const verifier = services.authVerifier as MemoryAuthVerifier;
  return verifier.register(opts);
}

// ---------------------------------------------------------------------------
// POST /posts/:postId/comments
// ---------------------------------------------------------------------------

export const createComment = endpoint({
  name: 'createComment',
  method: 'POST',
  path: '/posts/:postId/comments',
  summary: 'Comment on a post',
  description:
    'Any authenticated user can comment on any post — no ownership check. We still verify the parent post exists to surface a clean 404 for deleted posts.',
  tags: ['Comments'],
  beforeHandler: requireAuth,
  request: {
    params: { postId: t.string().format('uuid') },
    body: CreateComment,
  },
  responses: {
    201: { schema: Comment, description: 'Comment created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    404: { schema: ApiError, description: 'Parent post does not exist' },
  },
  handler: async (ctx) => {
    // Verify the parent post exists. We use the post repo directly
    // (not `loadOwnedPost`) because commenting does NOT require
    // ownership — anyone can comment on any post.
    const post = await ctx.services.postRepo.findById(ctx.params.postId);
    if (!post) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No post with id ${ctx.params.postId}.`,
      });
    }
    const comment = await ctx.services.commentRepo.create({
      postId: post.id,
      authorId: ctx.state.user.id,
      body: ctx.body.body,
    });
    return ctx.respond[201](comment);
  },
  behaviors: [
    scenario("Any authenticated user can comment on another user's post")
      .given('Alice wrote a post and Bob is logged in')
      .setup(async (services) => {
        seedUser(services, ALICE);
        const bobToken = seedUser(services, BOB);
        const post = await services.postRepo.create({
          authorId: ALICE.id,
          title: 'Alice post',
          body: 'Body',
        });
        return { bobToken, postId: post.id };
      })
      .headers({ authorization: 'Bearer {bobToken}' })
      .params({ postId: '{postId}' })
      .body({ body: 'Nice post!' })
      .when('I POST /posts/{postId}/comments')
      .then('response status is 201')
      .and('response body matches Comment')
      .and('response body has body "Nice post!"')
      .and('response body has authorId "22222222-2222-2222-2222-222222222222"'),

    scenario('Commenting on a missing post returns 404')
      .given('a logged-in user and no such post')
      .setup(async (services) => {
        const token = seedUser(services, ALICE);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ postId: '00000000-0000-0000-0000-000000000000' })
      .body({ body: 'Hello?' })
      .when('I POST /posts/{postId}/comments')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),

    scenario('Commenting without auth returns 401')
      .given('no credentials')
      .params({ postId: '00000000-0000-0000-0000-000000000000' })
      .body({ body: 'Anonymous' })
      .when('I POST /posts/{postId}/comments')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /posts/:postId/comments — public
// ---------------------------------------------------------------------------

export const listComments = endpoint({
  name: 'listComments',
  method: 'GET',
  path: '/posts/:postId/comments',
  summary: 'List all comments on a post (oldest first)',
  tags: ['Comments'],
  request: {
    params: { postId: t.string().format('uuid') },
  },
  responses: {
    200: { schema: t.array(Comment), description: 'All comments on the post' },
    404: { schema: ApiError, description: 'Parent post does not exist' },
  },
  handler: async (ctx) => {
    const post = await ctx.services.postRepo.findById(ctx.params.postId);
    if (!post) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No post with id ${ctx.params.postId}.`,
      });
    }
    const comments = await ctx.services.commentRepo.listByPost(post.id);
    return ctx.respond[200](comments);
  },
  behaviors: [
    scenario('Anyone can read the comments on a post')
      .given('a post with two comments')
      .setup(async (services) => {
        const post = await services.postRepo.create({
          authorId: ALICE.id,
          title: 'Open thread',
          body: 'Discuss',
        });
        await services.commentRepo.create({
          postId: post.id,
          authorId: BOB.id,
          body: 'First',
        });
        await services.commentRepo.create({
          postId: post.id,
          authorId: ALICE.id,
          body: 'Second',
        });
        return { postId: post.id };
      })
      .params({ postId: '{postId}' })
      .when('I GET /posts/{postId}/comments')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 2'),

    scenario('Listing comments on a missing post returns 404')
      .given('no posts')
      .params({ postId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /posts/{postId}/comments')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});
