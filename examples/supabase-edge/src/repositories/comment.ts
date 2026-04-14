/**
 * `CommentRepository` — interface + in-memory implementation.
 *
 * Same split as `./post.ts`: the interface is the contract, the
 * memory implementation is the test backend, and the Supabase
 * implementation lives in `./comment-supabase.ts` (imported only
 * by the Deno entry point, never by tests).
 */

import type { Infer } from '@triadjs/core';
import type { Comment as CommentSchema } from '../schemas/comment.js';

type Comment = Infer<typeof CommentSchema>;

export interface CreateCommentInput {
  postId: string;
  authorId: string;
  body: string;
}

export interface CommentRepository {
  create(input: CreateCommentInput): Promise<Comment>;
  listByPost(postId: string): Promise<Comment[]>;
}

// ---------------------------------------------------------------------------
// MemoryCommentRepository — the test-only implementation
// ---------------------------------------------------------------------------

/**
 * An in-memory `CommentRepository` keyed by comment id. `listByPost`
 * filters and sorts ascending (oldest first) to match the Supabase
 * implementation's ordering.
 */
export class MemoryCommentRepository implements CommentRepository {
  private readonly comments = new Map<string, Comment>();
  private lastTimestampMs = 0;

  async create(input: CreateCommentInput): Promise<Comment> {
    const now = Date.now();
    const nextMs =
      now <= this.lastTimestampMs ? this.lastTimestampMs + 1 : now;
    this.lastTimestampMs = nextMs;
    const comment: Comment = {
      id: crypto.randomUUID(),
      postId: input.postId,
      authorId: input.authorId,
      body: input.body,
      createdAt: new Date(nextMs).toISOString(),
    };
    this.comments.set(comment.id, comment);
    return comment;
  }

  async listByPost(postId: string): Promise<Comment[]> {
    return Array.from(this.comments.values())
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    this.comments.clear();
  }
}
