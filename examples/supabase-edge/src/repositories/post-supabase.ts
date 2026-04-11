/**
 * `SupabasePostRepository` — the production `PostRepository`.
 *
 * This class is imported ONLY by the Deno entry
 * (`supabase/functions/api/index.ts`) — never by tests. The Triad
 * test runner has no way to mock `@supabase/supabase-js`'s wire
 * protocol, so exercising this class directly would mean standing
 * up a local Supabase instance and running integration tests against
 * it. We opt out: tests cover behavior against `MemoryPostRepository`,
 * and this file is verified manually against a real project before
 * deploy. The trade-off is documented in `README.md` and the guide.
 *
 * ## rowToApi / apiToRow
 *
 * Supabase returns rows in snake_case (`author_id`, `created_at`)
 * because that's the Postgres convention. Triad's wire contract
 * speaks camelCase. We mediate at the repository boundary so nothing
 * above the repository layer has to think about the naming mismatch.
 *
 * ## Error handling
 *
 * `@supabase/supabase-js` returns `{ data, error }` tuples rather
 * than throwing. We convert real errors into `throw new Error(...)`
 * so the adapter's top-level `try/catch` can surface them as 500s.
 * The one exception is the "no rows returned" case from `.single()`,
 * which Supabase reports as error code `PGRST116` — we translate
 * that into `null` because it's a legitimate "not found" signal,
 * not a bug.
 *
 * ## Row Level Security
 *
 * If the Supabase client was constructed with the caller's
 * `Authorization` header (which is the pattern recommended by the
 * guide), every query below runs under Postgres RLS as that user.
 * That's the defense-in-depth story: even if a bug in the application
 * layer forgot to check ownership, RLS would still reject the write.
 * See `docs/guides/supabase.md` section 5 for the full discussion.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Infer } from '@triad/core';
import type { Post as PostSchema } from '../schemas/post.js';
import type {
  CreatePostInput,
  ListPostsOptions,
  ListPostsResult,
  PostRepository,
  UpdatePostInput,
} from './post.js';

type Post = Infer<typeof PostSchema>;

/** Shape of a `posts` row returned by Supabase. */
interface PostRow {
  id: string;
  author_id: string;
  title: string;
  body: string;
  created_at: string;
}

export class SupabasePostRepository implements PostRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreatePostInput): Promise<Post> {
    const { data, error } = await this.supabase
      .from('posts')
      .insert({
        author_id: input.authorId,
        title: input.title,
        body: input.body,
      })
      .select()
      .single();
    if (error) throw new Error(`posts.insert failed: ${error.message}`);
    return this.rowToApi(data as PostRow);
  }

  async findById(id: string): Promise<Post | null> {
    const { data, error } = await this.supabase
      .from('posts')
      .select()
      .eq('id', id)
      .single();
    // PGRST116 = "JSON object requested, multiple (or no) rows returned".
    // For `.single()` it means "no rows matched", which is not an error
    // from the caller's perspective — translate to `null`.
    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`posts.findById failed: ${error.message}`);
    return this.rowToApi(data as PostRow);
  }

  async list(options: ListPostsOptions): Promise<ListPostsResult> {
    // Keyset pagination via `created_at < cursor` — newest first.
    // Fetch limit+1 rows to detect whether another page exists.
    let query = this.supabase
      .from('posts')
      .select()
      .order('created_at', { ascending: false })
      .limit(options.limit + 1);
    if (options.cursorCreatedAt !== undefined) {
      query = query.lt('created_at', options.cursorCreatedAt);
    }
    const { data, error } = await query;
    if (error) throw new Error(`posts.list failed: ${error.message}`);
    const rows = (data ?? []) as PostRow[];
    const hasMore = rows.length > options.limit;
    const items = (hasMore ? rows.slice(0, options.limit) : rows).map((r) =>
      this.rowToApi(r),
    );
    const nextCursorRaw = hasMore
      ? (items[items.length - 1]?.createdAt ?? null)
      : null;
    return { items, nextCursorRaw };
  }

  async update(id: string, patch: UpdatePostInput): Promise<Post | null> {
    // Build a snake_case patch so we don't send undefined columns.
    const row: Partial<Pick<PostRow, 'title' | 'body'>> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.body !== undefined) row.body = patch.body;

    const { data, error } = await this.supabase
      .from('posts')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`posts.update failed: ${error.message}`);
    return this.rowToApi(data as PostRow);
  }

  async delete(id: string): Promise<boolean> {
    const { error, count } = await this.supabase
      .from('posts')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(`posts.delete failed: ${error.message}`);
    return (count ?? 0) > 0;
  }

  private rowToApi(row: PostRow): Post {
    return {
      id: row.id,
      authorId: row.author_id,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    };
  }
}
