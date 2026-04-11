/**
 * `SupabaseCommentRepository` — the production `CommentRepository`.
 *
 * Shares the same tradeoffs as `./post-supabase.ts`: imported only
 * by the Deno entry, verified manually against a real project, and
 * runs under RLS using the caller's JWT when the client is built
 * per-request.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Infer } from '@triad/core';
import type { Comment as CommentSchema } from '../schemas/comment.js';
import type {
  CommentRepository,
  CreateCommentInput,
} from './comment.js';

type Comment = Infer<typeof CommentSchema>;

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export class SupabaseCommentRepository implements CommentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreateCommentInput): Promise<Comment> {
    const { data, error } = await this.supabase
      .from('comments')
      .insert({
        post_id: input.postId,
        author_id: input.authorId,
        body: input.body,
      })
      .select()
      .single();
    if (error) throw new Error(`comments.insert failed: ${error.message}`);
    return this.rowToApi(data as CommentRow);
  }

  async listByPost(postId: string): Promise<Comment[]> {
    const { data, error } = await this.supabase
      .from('comments')
      .select()
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`comments.listByPost failed: ${error.message}`);
    return ((data ?? []) as CommentRow[]).map((r) => this.rowToApi(r));
  }

  private rowToApi(row: CommentRow): Comment {
    return {
      id: row.id,
      postId: row.post_id,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at,
    };
  }
}
