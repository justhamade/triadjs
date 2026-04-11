/**
 * Access-control helper for the Posts bounded context.
 *
 * Mirrors `examples/tasktracker/src/access.ts` exactly: compose
 * Triad's generic `checkOwnership` with this example's repository
 * shape, and return a structured `{ status, error }` tuple the
 * caller passes to the right `ctx.respond[...]` slot.
 *
 * We distinguish 404 (post doesn't exist) from 403 (exists but
 * belongs to another user). Some teams prefer to collapse both
 * into 404 to defeat enumeration attacks; both choices are
 * legitimate and the framework is agnostic.
 *
 * NOTE: Authorization in this example is LAYERED. This helper is
 * the application-level check — readable, explicit, test-friendly.
 * In production the Supabase database ALSO runs Row-Level Security
 * policies that enforce the same rule at the storage layer, so a
 * bug in the application check can't leak data. See
 * `docs/guides/supabase.md` §5 for the RLS side of the story.
 */

import type { Infer } from '@triad/core';
import { checkOwnership } from '@triad/core';
import type { Post } from './schemas/post.js';
import type { SupabaseEdgeServices } from './services.js';

type PostValue = Infer<typeof Post>;
type ErrorBody = { code: string; message: string };

export type LoadedPost =
  | { ok: true; post: PostValue }
  | { ok: false; status: 404 | 403; error: ErrorBody };

export async function loadOwnedPost(
  services: Pick<SupabaseEdgeServices, 'postRepo'>,
  postId: string,
  userId: string,
): Promise<LoadedPost> {
  const post = await services.postRepo.findById(postId);
  const result = checkOwnership(post, userId, (p) => p.authorId);
  if (result.ok) return { ok: true, post: result.entity };
  if (result.reason === 'not_found') {
    return {
      ok: false,
      status: 404,
      error: { code: 'NOT_FOUND', message: `No post with id ${postId}.` },
    };
  }
  return {
    ok: false,
    status: 403,
    error: { code: 'FORBIDDEN', message: 'You are not the author of this post.' },
  };
}
