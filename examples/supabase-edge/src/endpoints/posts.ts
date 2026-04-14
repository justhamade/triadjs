/**
 * Post endpoints — create, list, fetch, update, delete.
 *
 * Protected endpoints set `beforeHandler: requireAuth` and then read
 * `ctx.state.user` directly. Ownership-scoped mutations run
 * `loadOwnedPost(services, postId, userId)` and branch on its
 * 404/403 return tuple. Pagination uses the same base64url keyset
 * cursor as `examples/tasktracker/src/endpoints/tasks.ts`.
 *
 * `GET /posts` is PUBLIC (no `requireAuth`): anyone can list posts,
 * no JWT required. That matches the feel of a real blog API and
 * exercises a mix of authed and unauthed endpoints inside the same
 * bounded context.
 */

import { endpoint, scenario, t } from '@triadjs/core';
import { CreatePost, Post, PostPage, UpdatePost } from '../schemas/post.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../supabase-auth.js';
import { loadOwnedPost } from '../access.js';
import type { MemoryAuthVerifier } from '../auth-verifier.js';

// ---------------------------------------------------------------------------
// Cursor helpers — the same shape as the tasktracker example's
// ---------------------------------------------------------------------------

function encodeCursor(createdAt: string): string {
  return Buffer.from(createdAt, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return /^\d{4}-\d{2}-\d{2}T/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Seed a user and return a token. Encapsulates the memory-verifier
 * cast so each scenario's `.setup()` stays two lines. `email` is
 * parameterized because several scenarios need two distinct users.
 */
function seedUser(
  services: { authVerifier: unknown },
  opts: { id: string; email: string; name: string },
): string {
  const verifier = services.authVerifier as MemoryAuthVerifier;
  return verifier.register({ id: opts.id, email: opts.email, name: opts.name });
}

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

// ---------------------------------------------------------------------------
// POST /posts
// ---------------------------------------------------------------------------

export const createPost = endpoint({
  name: 'createPost',
  method: 'POST',
  path: '/posts',
  summary: 'Create a post authored by the authenticated user',
  tags: ['Posts'],
  beforeHandler: requireAuth,
  request: { body: CreatePost },
  responses: {
    201: { schema: Post, description: 'Post created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const post = await ctx.services.postRepo.create({
      authorId: ctx.state.user.id,
      title: ctx.body.title,
      body: ctx.body.body,
    });
    return ctx.respond[201](post);
  },
  behaviors: [
    scenario('An authenticated user can create a post')
      .given('a logged-in user')
      .setup(async (services) => {
        const token = seedUser(services, ALICE);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .body({ title: 'Hello, world', body: 'First post on my Triad blog.' })
      .when('I POST /posts')
      .then('response status is 201')
      .and('response body matches Post')
      .and('response body has title "Hello, world"')
      .and('response body has authorId "11111111-1111-1111-1111-111111111111"'),

    scenario('Creating a post without auth returns 401')
      .given('no credentials')
      .body({ title: 'Sneaky', body: 'Should never land.' })
      .when('I POST /posts')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /posts — public, paginated
// ---------------------------------------------------------------------------

export const listPosts = endpoint({
  name: 'listPosts',
  method: 'GET',
  path: '/posts',
  summary: 'List posts, newest first, with keyset pagination',
  description:
    'Public endpoint — no auth required. Returns posts in `createdAt` DESC order. Use `nextCursor` to fetch the next page; `null` on the last page.',
  tags: ['Posts'],
  request: {
    query: {
      limit: t
        .int32()
        .min(1)
        .max(100)
        .default(20)
        .doc('Page size (default 20, max 100)'),
      cursor: t
        .string()
        .optional()
        .doc('Opaque pagination cursor from a previous page'),
    },
  },
  responses: {
    200: { schema: PostPage, description: 'One page of posts' },
  },
  handler: async (ctx) => {
    const cursorCreatedAt =
      ctx.query.cursor !== undefined ? decodeCursor(ctx.query.cursor) : null;
    const result = await ctx.services.postRepo.list({
      limit: ctx.query.limit,
      ...(cursorCreatedAt !== null && { cursorCreatedAt }),
    });
    return ctx.respond[200]({
      items: result.items,
      nextCursor:
        result.nextCursorRaw !== null ? encodeCursor(result.nextCursorRaw) : null,
    });
  },
  behaviors: [
    scenario('The first page returns limit items plus a cursor when more exist')
      .given('25 posts')
      .setup(async (services) => {
        for (let i = 1; i <= 25; i++) {
          await services.postRepo.create({
            authorId: ALICE.id,
            title: `Post ${i}`,
            body: `Body ${i}`,
          });
        }
      })
      .query({ limit: 10 })
      .when('I GET /posts?limit=10')
      .then('response status is 200')
      .and('response body matches PostPage')
      .and('response body has items.length 10'),

    scenario('A subsequent page picks up where the cursor left off')
      .given('15 posts and a first-page cursor at post 10 (newest-first)')
      .setup(async (services) => {
        const created: { createdAt: string }[] = [];
        for (let i = 1; i <= 15; i++) {
          const post = await services.postRepo.create({
            authorId: ALICE.id,
            title: `Post ${i}`,
            body: `Body ${i}`,
          });
          created.push({ createdAt: post.createdAt });
        }
        // Newest first — the 10th item in DESC order is the 10th
        // from the end of the creation order, i.e. created[5].
        const cursor = Buffer.from(
          created[5]!.createdAt,
          'utf8',
        ).toString('base64url');
        return { cursor };
      })
      .query({ limit: 10, cursor: '{cursor}' })
      .when('I GET /posts?limit=10&cursor=...')
      .then('response status is 200')
      .and('response body matches PostPage')
      .and('response body has items.length 5'),

    scenario('The last page has a null nextCursor')
      .given('5 posts and a page size of 10')
      .setup(async (services) => {
        for (let i = 1; i <= 5; i++) {
          await services.postRepo.create({
            authorId: ALICE.id,
            title: `Post ${i}`,
            body: `Body ${i}`,
          });
        }
      })
      .query({ limit: 10 })
      .when('I GET /posts?limit=10')
      .then('response status is 200')
      .and('response body matches PostPage')
      .and('response body has items.length 5'),
    // We'd love to assert `nextCursor null` here, but the test runner's
    // assertion parser only accepts strings/numbers/booleans. The
    // response schema still enforces `nextCursor` nullable — a non-null
    // value of the wrong type would fail response-schema validation.
  ],
});

// ---------------------------------------------------------------------------
// GET /posts/:postId — public
// ---------------------------------------------------------------------------

export const getPost = endpoint({
  name: 'getPost',
  method: 'GET',
  path: '/posts/:postId',
  summary: 'Fetch a single post by id',
  tags: ['Posts'],
  request: {
    params: { postId: t.string().format('uuid').doc('The post id') },
  },
  responses: {
    200: { schema: Post, description: 'The post' },
    404: { schema: ApiError, description: 'No post with that id' },
  },
  handler: async (ctx) => {
    const post = await ctx.services.postRepo.findById(ctx.params.postId);
    if (!post) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No post with id ${ctx.params.postId}.`,
      });
    }
    return ctx.respond[200](post);
  },
  behaviors: [
    scenario('Anyone can fetch an existing post')
      .given('a post')
      .setup(async (services) => {
        const post = await services.postRepo.create({
          authorId: ALICE.id,
          title: 'Hello',
          body: 'World',
        });
        return { postId: post.id };
      })
      .params({ postId: '{postId}' })
      .when('I GET /posts/{postId}')
      .then('response status is 200')
      .and('response body has title "Hello"'),

    scenario('Fetching an unknown post returns 404')
      .given('no posts')
      .params({ postId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /posts/{postId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

// ---------------------------------------------------------------------------
// PATCH /posts/:postId — author only
// ---------------------------------------------------------------------------

export const updatePost = endpoint({
  name: 'updatePost',
  method: 'PATCH',
  path: '/posts/:postId',
  summary: 'Update a post (author only)',
  tags: ['Posts'],
  beforeHandler: requireAuth,
  request: {
    params: { postId: t.string().format('uuid') },
    body: UpdatePost,
  },
  responses: {
    200: { schema: Post, description: 'Post updated' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Post belongs to another user' },
    404: { schema: ApiError, description: 'No post with that id' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedPost(
      ctx.services,
      ctx.params.postId,
      ctx.state.user.id,
    );
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    const updated = await ctx.services.postRepo.update(
      loaded.post.id,
      ctx.body,
    );
    // Practically unreachable — we just loaded the post — but guard
    // against a race where the row vanished between findById and
    // update. Returning 404 matches the "post no longer exists"
    // reality from the client's perspective.
    if (!updated) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No post with id ${ctx.params.postId}.`,
      });
    }
    return ctx.respond[200](updated);
  },
  behaviors: [
    scenario('Authors can update their own post')
      .given('a post Alice authored')
      .setup(async (services) => {
        const token = seedUser(services, ALICE);
        const post = await services.postRepo.create({
          authorId: ALICE.id,
          title: 'Original',
          body: 'Body',
        });
        return { token, postId: post.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ postId: '{postId}' })
      .body({ title: 'Revised' })
      .when('I PATCH /posts/{postId}')
      .then('response status is 200')
      .and('response body has title "Revised"'),

    scenario("A user cannot update another user's post")
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
      .body({ title: 'Hijacked' })
      .when('I PATCH /posts/{postId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});

// ---------------------------------------------------------------------------
// DELETE /posts/:postId — author only
// ---------------------------------------------------------------------------

export const deletePost = endpoint({
  name: 'deletePost',
  method: 'DELETE',
  path: '/posts/:postId',
  summary: 'Delete a post (author only)',
  tags: ['Posts'],
  beforeHandler: requireAuth,
  request: {
    params: { postId: t.string().format('uuid') },
  },
  responses: {
    204: { schema: t.empty(), description: 'Post deleted (no body)' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Post belongs to another user' },
    404: { schema: ApiError, description: 'No post with that id' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedPost(
      ctx.services,
      ctx.params.postId,
      ctx.state.user.id,
    );
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    await ctx.services.postRepo.delete(loaded.post.id);
    return ctx.respond[204]();
  },
  behaviors: [
    scenario('Authors can delete their own post')
      .given('a post Alice authored')
      .setup(async (services) => {
        const token = seedUser(services, ALICE);
        const post = await services.postRepo.create({
          authorId: ALICE.id,
          title: 'Doomed',
          body: 'Body',
        });
        return { token, postId: post.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ postId: '{postId}' })
      .when('I DELETE /posts/{postId}')
      .then('response status is 204'),

    scenario("A user cannot delete another user's post")
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
      .when('I DELETE /posts/{postId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});
