/**
 * Router definition — the entry point consumed by `triad.config.ts`
 * (for docs/tests/gherkin/validate), `src/server.ts` (the Node dev
 * server), and `supabase/functions/api/index.ts` (the Deno deploy
 * target).
 *
 * Three bounded contexts — Auth, Posts, Comments — mirroring the
 * shape of `examples/tasktracker`. Each declares its own ubiquitous
 * language via `models[]` so `triad validate` can catch cross-
 * context model leakage.
 *
 * This file is 100% runtime-agnostic: no Node built-ins, no Supabase
 * client, no Deno globals. That's what lets the same router definition
 * run on Node (tests + dev server) AND on Deno (the Edge Function).
 * The adapter and the services container are the only runtime-aware
 * layers.
 */

import { createRouter } from '@triadjs/core';

import { getMe } from './endpoints/auth.js';
import {
  createPost,
  deletePost,
  getPost,
  listPosts,
  updatePost,
} from './endpoints/posts.js';
import { createComment, listComments } from './endpoints/comments.js';

import { User } from './schemas/user.js';
import { CreatePost, Post, PostPage, UpdatePost } from './schemas/post.js';
import { Comment, CreateComment } from './schemas/comment.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Triad Supabase Edge Example',
  version: '1.0.0',
  description:
    'Triad reference example #4 — a tiny blog API deployed as a Supabase Edge Function on Deno via @triadjs/hono. Demonstrates Supabase Auth JWT validation, per-request Supabase clients, ownership-based authorization, and the repository pattern against @supabase/supabase-js.',
  servers: [
    { url: 'http://localhost:3300', description: 'Local Node dev server' },
    {
      url: 'https://<project-ref>.supabase.co/functions/v1/api',
      description: 'Deployed Supabase Edge Function',
    },
  ],
});

router.context(
  'Auth',
  {
    description:
      'Identity derived from a Supabase Auth JWT. Registration and login flows live in Supabase Auth itself — this context only exposes the derived `/me` endpoint.',
    models: [User, ApiError],
  },
  (ctx) => {
    ctx.add(getMe);
  },
);

router.context(
  'Posts',
  {
    description:
      'Blog posts owned by the authenticated user. Public read (list + fetch), authenticated write, ownership-scoped update + delete.',
    models: [Post, CreatePost, UpdatePost, PostPage, ApiError],
  },
  (ctx) => {
    ctx.add(createPost, listPosts, getPost, updatePost, deletePost);
  },
);

router.context(
  'Comments',
  {
    description:
      'Comments nested under posts. Any authenticated user may comment on any post — there is no ownership check on the parent post. Listing is public.',
    models: [
      // Comments reach into Posts for the parent-exists check, so
      // Post shows up here as a cross-boundary read. Listing it
      // keeps `triad validate` happy.
      Post,
      Comment,
      CreateComment,
      ApiError,
    ],
  },
  (ctx) => {
    ctx.add(createComment, listComments);
  },
);

export default router;
