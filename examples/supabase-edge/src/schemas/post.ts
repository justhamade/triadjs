/**
 * Post schemas — the Posts bounded context.
 *
 * A post is owned by exactly one user (`authorId`) and can accumulate
 * any number of comments. `Post` is the canonical response shape;
 * `CreatePost` and `UpdatePost` are derived via `.pick()` so the
 * user-writable fields have a single source of truth — the same
 * pattern `examples/tasktracker/src/schemas/project.ts` uses.
 *
 * `authorId` is deliberately NOT user-writable. The authenticated
 * user's id (from the Supabase JWT) is the only legitimate value
 * for this field, so it's derived on the server from `ctx.state.user`
 * rather than taken from the body. This is the same reason the
 * tasktracker's `Project` doesn't expose `ownerId` on `CreateProject`:
 * fields the server controls should never come from the client.
 *
 * `PostPage` is the pagination envelope for `GET /posts`. It mirrors
 * tasktracker's `TaskPage` — `{ items, nextCursor }` — so anyone
 * moving between examples sees the same contract.
 */

import { t } from '@triad/core';

export const Post = t.model('Post', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique post identifier'),
  authorId: t
    .string()
    .format('uuid')
    .storage({ references: 'auth.users.id', indexed: true })
    .doc('The user (Supabase Auth id) who authored this post'),
  title: t.string().minLength(1).maxLength(200).doc('Post title'),
  body: t
    .string()
    .minLength(1)
    .maxLength(10_000)
    .doc('Post body (markdown or plain text — the API does not care)'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, indexed: true })
    .doc('Creation timestamp — also used as the keyset pagination cursor'),
});

/** Input for POST /posts — only user-controlled fields. */
export const CreatePost = Post.pick('title', 'body').named('CreatePost');

/**
 * Input for PATCH /posts/:postId — title and body are both mutable.
 * `.partial()` means every field is optional: clients can send just
 * `{title}` to rename without resubmitting the body.
 */
export const UpdatePost = Post.pick('title', 'body').partial().named('UpdatePost');

/**
 * Pagination envelope. `nextCursor` is `null` on the last page so
 * clients can loop `while (page.nextCursor !== null)` without counting
 * items or inspecting HTTP headers.
 */
export const PostPage = t.model('PostPage', {
  items: t.array(Post).doc('The posts on this page, ordered by createdAt DESC'),
  nextCursor: t
    .string()
    .nullable()
    .doc(
      'Opaque cursor. Pass it back as ?cursor=<value> to fetch the next page. `null` on the last page.',
    ),
});
