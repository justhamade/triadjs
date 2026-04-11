/**
 * `PostRepository` — the interface plus an in-memory implementation.
 *
 * ## Why an interface here and a raw class in tasktracker
 *
 * `examples/tasktracker` uses a single Drizzle-backed class and passes
 * a `:memory:` SQLite database in tests. That works because Drizzle
 * is isomorphic (same class, different DB). Here we can't pull the
 * same trick: `@supabase/supabase-js` is a network client and the
 * Triad test runner has no way to mock Supabase's wire protocol. So
 * we split storage into two concrete implementations behind one
 * interface:
 *
 *   - `MemoryPostRepository` (below) — used by every `triad test`
 *     scenario. Plain in-process state, zero network.
 *   - `SupabasePostRepository` (in `./post-supabase.ts`) — used at
 *     deploy time. The Deno entry point wires it up; tests never
 *     import it.
 *
 * The repository interface is the contract; the two classes are
 * interchangeable at runtime. `createServices({ mode })` picks which
 * to instantiate. Every endpoint handler in this example speaks the
 * interface only — no code below `services.ts` knows (or cares)
 * whether the persistence layer is Supabase or an in-memory `Map`.
 *
 * ## Why the memory repo lives alongside the interface
 *
 * The alternative is a dedicated `post-memory.ts` module, mirroring
 * the Supabase one. We co-locate the interface with its in-memory
 * implementation because the memory version is the only one tests
 * ever import — keeping them in the same file means a contributor
 * reading `post.ts` never needs a second jump to understand what a
 * repository does at test time.
 */

import type { Infer } from '@triad/core';
import type { Post as PostSchema } from '../schemas/post.js';

type Post = Infer<typeof PostSchema>;

export interface CreatePostInput {
  authorId: string;
  title: string;
  body: string;
}

export interface UpdatePostInput {
  title?: string;
  body?: string;
}

export interface ListPostsOptions {
  limit: number;
  /** Keyset cursor — the `createdAt` timestamp of the last seen item. */
  cursorCreatedAt?: string;
}

export interface ListPostsResult {
  items: Post[];
  /** The raw (un-encoded) next-page cursor, or `null` if this is the last page. */
  nextCursorRaw: string | null;
}

/**
 * The repository contract. Both `MemoryPostRepository` and
 * `SupabasePostRepository` implement this interface so handlers can
 * stay storage-agnostic.
 */
export interface PostRepository {
  create(input: CreatePostInput): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  list(options: ListPostsOptions): Promise<ListPostsResult>;
  update(id: string, patch: UpdatePostInput): Promise<Post | null>;
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// MemoryPostRepository — the test-only implementation
// ---------------------------------------------------------------------------

/**
 * An in-memory `PostRepository`. Used by every `triad test` scenario.
 *
 * State is a `Map<id, Post>`. Ordering in `list()` is `createdAt`
 * descending (newest first) to match the Supabase implementation's
 * default sort. Keyset pagination uses the cursor as a strict upper
 * bound on `createdAt`.
 *
 * This class makes zero assumptions about concurrent access — each
 * test scenario gets a fresh instance via `createTestServices()`,
 * so there are no cross-scenario races to worry about.
 */
export class MemoryPostRepository implements PostRepository {
  private readonly posts = new Map<string, Post>();

  async create(input: CreatePostInput): Promise<Post> {
    // Using `crypto.randomUUID` from the Web Crypto global — available
    // on Node 19+, Deno, and Bun. No import needed.
    const post: Post = {
      id: crypto.randomUUID(),
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      // We deliberately step timestamps forward by 1ms when the previous
      // post shares the same instant. The keyset pagination test relies
      // on strictly monotonic `createdAt` values to produce stable
      // page boundaries — sharing a millisecond would put two posts
      // on the cursor edge and break the "first page has exactly N
      // items" assertion.
      createdAt: this.nextTimestamp(),
    };
    this.posts.set(post.id, post);
    return post;
  }

  async findById(id: string): Promise<Post | null> {
    return this.posts.get(id) ?? null;
  }

  async list(options: ListPostsOptions): Promise<ListPostsResult> {
    // Sort newest first — same order the Supabase implementation emits.
    const all = Array.from(this.posts.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    const filtered =
      options.cursorCreatedAt !== undefined
        ? all.filter((p) => p.createdAt < options.cursorCreatedAt!)
        : all;

    // Fetch limit+1 rows to detect whether another page exists without
    // a separate COUNT query. If we got `limit + 1` back, there's more.
    const page = filtered.slice(0, options.limit + 1);
    const hasMore = page.length > options.limit;
    const items = hasMore ? page.slice(0, options.limit) : page;
    const nextCursorRaw = hasMore
      ? (items[items.length - 1]?.createdAt ?? null)
      : null;

    return { items, nextCursorRaw };
  }

  async update(id: string, patch: UpdatePostInput): Promise<Post | null> {
    const existing = this.posts.get(id);
    if (!existing) return null;
    const updated: Post = {
      ...existing,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.body !== undefined && { body: patch.body }),
    };
    this.posts.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.posts.delete(id);
  }

  async clear(): Promise<void> {
    this.posts.clear();
  }

  /**
   * Emit a `createdAt` strictly greater than every previous value.
   * See the comment in `create()` for why strict monotonicity matters.
   */
  private lastTimestampMs = 0;
  private nextTimestamp(): string {
    const now = Date.now();
    const next = now <= this.lastTimestampMs ? this.lastTimestampMs + 1 : now;
    this.lastTimestampMs = next;
    return new Date(next).toISOString();
  }
}
