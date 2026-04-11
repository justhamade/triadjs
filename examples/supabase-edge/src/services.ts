/**
 * Service container wiring.
 *
 * One `createServices()` function drives both the production Deno
 * entry and the per-scenario test setup. The `mode` option picks
 * which concrete repository/verifier to instantiate:
 *
 *   - `mode: 'memory'` — uses the in-process `MemoryPostRepository`,
 *     `MemoryCommentRepository`, and `MemoryAuthVerifier`. This is
 *     what `test-setup.ts` and `server.ts` (the Node dev server)
 *     call. No Supabase client required; no network required.
 *
 *   - `mode: 'supabase'` — uses `SupabasePostRepository`,
 *     `SupabaseCommentRepository`, and `SupabaseAuthVerifier`,
 *     constructed around a per-request Supabase client. The Deno
 *     entry (`supabase/functions/api/index.ts`) calls this branch.
 *
 * Declaration-merging `ServiceContainer` gives every handler static
 * typing for `ctx.services.*` without manual imports in each
 * endpoint file — the same "one tax, paid once" the tasktracker
 * uses.
 *
 * ## Why the Supabase implementations are imported dynamically
 *
 * `./repositories/post-supabase.ts` and friends import
 * `@supabase/supabase-js`. When the test runner loads this module,
 * it also pulls in the Supabase client library — that's fine for
 * production but bloats test startup and means every test contributor
 * has to install `@supabase/supabase-js` even though tests never
 * exercise it. We hide the Supabase branch behind a dynamic import
 * so memory-mode callers never touch it.
 *
 * The dynamic import is awaited inside `createServices()` only when
 * `mode === 'supabase'`, so tests (which always pass `mode: 'memory'`
 * synchronously) stay fully synchronous-from-the-outside.
 */

import {
  MemoryCommentRepository,
  type CommentRepository,
} from './repositories/comment.js';
import {
  MemoryPostRepository,
  type PostRepository,
} from './repositories/post.js';
import {
  MemoryAuthVerifier,
  type AuthVerifier,
} from './auth-verifier.js';

// Avoid a value import of `@supabase/supabase-js` at the top of this
// file — tests should never transitively load it. We only reach for
// the type here, which tsc erases at compile time.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseEdgeServices {
  postRepo: PostRepository;
  commentRepo: CommentRepository;
  authVerifier: AuthVerifier;
}

declare module '@triad/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ServiceContainer extends SupabaseEdgeServices {}
}

export type CreateServicesOptions =
  | {
      mode: 'memory';
      /**
       * Provide a pre-built `MemoryAuthVerifier` if you want tests
       * to hold a reference for seeding users. Omitted → a fresh
       * empty verifier is created.
       */
      authVerifier?: MemoryAuthVerifier;
    }
  | {
      mode: 'supabase';
      supabase: SupabaseClient;
    };

/**
 * Build a fresh `SupabaseEdgeServices` bundle.
 *
 * Memory mode is synchronous; Supabase mode is async because it
 * dynamically imports the Supabase-backed repositories to keep them
 * off the hot path of the test runner.
 */
export function createServices(
  options: Extract<CreateServicesOptions, { mode: 'memory' }>,
): SupabaseEdgeServices;
export function createServices(
  options: Extract<CreateServicesOptions, { mode: 'supabase' }>,
): Promise<SupabaseEdgeServices>;
export function createServices(
  options: CreateServicesOptions,
): SupabaseEdgeServices | Promise<SupabaseEdgeServices> {
  if (options.mode === 'memory') {
    return {
      postRepo: new MemoryPostRepository(),
      commentRepo: new MemoryCommentRepository(),
      authVerifier: options.authVerifier ?? new MemoryAuthVerifier(),
    };
  }
  return buildSupabaseServices(options.supabase);
}

async function buildSupabaseServices(
  supabase: SupabaseClient,
): Promise<SupabaseEdgeServices> {
  const [{ SupabasePostRepository }, { SupabaseCommentRepository }, { SupabaseAuthVerifier }] =
    await Promise.all([
      import('./repositories/post-supabase.js'),
      import('./repositories/comment-supabase.js'),
      import('./auth-verifier-supabase.js'),
    ]);
  return {
    postRepo: new SupabasePostRepository(supabase),
    commentRepo: new SupabaseCommentRepository(supabase),
    authVerifier: new SupabaseAuthVerifier(supabase),
  };
}
