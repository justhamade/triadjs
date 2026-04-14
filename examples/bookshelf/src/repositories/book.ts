/**
 * Drizzle-backed `BookRepository`.
 *
 * Pagination is keyset-style on `createdAt` — exactly the same pattern
 * the tasktracker example uses for its tasks. The handler is
 * responsible for encoding/decoding the opaque `nextCursor` string;
 * the repository just takes a raw ISO timestamp and returns a "last
 * row's createdAt, or null if this was the final page" result.
 *
 * Listing is scoped to an owner — the Library context does not
 * expose books you don't own. Cross-owner visibility is not a product
 * feature here.
 */

import { and, asc, eq, gt } from 'drizzle-orm';
import type { Infer } from '@triadjs/core';
import type { InferRow, InferInsert } from '@triadjs/drizzle';

import type { Db } from '../db/client.js';
import { books } from '../db/schema.js';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;
type BookRow = InferRow<typeof books>;
type BookInsert = InferInsert<typeof books>;

export interface CreateBookInput {
  ownerId: string;
  title: string;
  author: string;
  isbn?: string;
  publishedYear: number;
}

export interface UpdateBookInput {
  title?: string;
  author?: string;
  isbn?: string;
}

export interface ListBooksOptions {
  ownerId: string;
  limit: number;
  /** Exclusive lower-bound cursor — only rows with `createdAt > cursor` are returned. */
  cursorCreatedAt?: string;
}

export interface ListBooksResult {
  items: Book[];
  /** Raw `createdAt` of the last item when another page exists, else null. */
  nextCursorRaw: string | null;
}

export class BookRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: BookRow): Book {
    const book: Book = {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      author: row.author,
      publishedYear: row.publishedYear,
      createdAt: row.createdAt,
    };
    if (row.isbn !== null) {
      book.isbn = row.isbn;
    }
    return book;
  }

  async create(input: CreateBookInput): Promise<Book> {
    const row: BookInsert = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      title: input.title,
      author: input.author,
      isbn: input.isbn ?? null,
      publishedYear: input.publishedYear,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(books).values(row).run();
    return this.rowToApi(row as BookRow);
  }

  async findById(id: string): Promise<Book | null> {
    const row = this.db.select().from(books).where(eq(books.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async listForOwner(options: ListBooksOptions): Promise<ListBooksResult> {
    const conditions = [eq(books.ownerId, options.ownerId)];
    if (options.cursorCreatedAt) {
      conditions.push(gt(books.createdAt, options.cursorCreatedAt));
    }

    // Fetch one extra row so we can tell whether another page exists
    // without a COUNT query.
    const rows = this.db
      .select()
      .from(books)
      .where(and(...conditions))
      .orderBy(asc(books.createdAt))
      .limit(options.limit + 1)
      .all();

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const items = page.map((r) => this.rowToApi(r));
    const nextCursorRaw = hasMore ? page[page.length - 1]!.createdAt : null;
    return { items, nextCursorRaw };
  }

  async update(id: string, patch: UpdateBookInput): Promise<Book | null> {
    const updates: Partial<BookInsert> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.author !== undefined) updates.author = patch.author;
    if (patch.isbn !== undefined) updates.isbn = patch.isbn;
    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }
    const result = this.db
      .update(books)
      .set(updates)
      .where(eq(books.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(books).where(eq(books.id, id)).run();
    return result.changes > 0;
  }

  async clear(): Promise<void> {
    this.db.delete(books).run();
  }
}
