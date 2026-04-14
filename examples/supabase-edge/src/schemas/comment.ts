/**
 * Comment schemas — the Comments bounded context.
 *
 * Comments are nested under posts: every comment belongs to exactly
 * one post and knows its author. Authorization differs from posts:
 * ANY authenticated user may comment on ANY post, so the comment
 * endpoints only require `requireAuth` — no ownership check on the
 * parent post.
 *
 * We still verify the parent post EXISTS before accepting a comment
 * (to surface a clean 404 when a client comments on a deleted post);
 * that's a lookup, not an ownership check.
 */

import { t } from '@triadjs/core';

export const Comment = t.model('Comment', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique comment identifier'),
  postId: t
    .string()
    .format('uuid')
    .storage({ references: 'posts.id', indexed: true })
    .doc('The post this comment belongs to'),
  authorId: t
    .string()
    .format('uuid')
    .storage({ references: 'auth.users.id', indexed: true })
    .doc('The user (Supabase Auth id) who wrote this comment'),
  body: t.string().minLength(1).maxLength(2_000).doc('Comment body'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, indexed: true })
    .doc('Creation timestamp'),
});

/**
 * Input for POST /posts/:postId/comments. The client only supplies
 * the body — `postId` comes from the URL, `authorId` from the JWT.
 */
export const CreateComment = Comment.pick('body').named('CreateComment');
