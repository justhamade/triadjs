/**
 * Drizzle-backed `TaskRepository`.
 *
 * Two notable differences from petstore's `PetRepository`:
 *
 *   1. `list` takes a `projectId` parameter and keyset pagination
 *      arguments. The cursor is the `createdAt` timestamp of the last
 *      row on the previous page; we fetch `limit + 1` rows so we can
 *      cheaply detect whether another page exists without a COUNT(*)
 *      query. The handler is responsible for encoding/decoding the
 *      base64 cursor — the repository just takes a raw timestamp.
 *
 *   2. Status-filter and cursor conditions compose via an `and(...)`
 *      array because Drizzle's query builder treats an empty `and()`
 *      as "always true". Collecting conditions first and applying
 *      them at the end keeps the code linear and avoids the nested
 *      `if (filter.cursor) query = query.where(...)` pattern that
 *      triggers Drizzle's type-narrowing quirks.
 */

import { and, asc, eq, gt } from 'drizzle-orm';
import type { Infer } from '@triad/core';
import type { InferRow, InferInsert } from '@triad/drizzle';

import type { Db } from '../db/client.js';
import { tasks } from '../db/schema.js';
import type { Task as TaskSchema } from '../schemas/task.js';

type Task = Infer<typeof TaskSchema>;
type TaskRow = InferRow<typeof tasks>;
type TaskInsert = InferInsert<typeof tasks>;

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  status?: Task['status'];
}

export interface ListTasksOptions {
  projectId: string;
  status?: Task['status'];
  /** Exclusive lower-bound cursor — only rows with `createdAt > cursor` are returned. */
  cursorCreatedAt?: string;
  /** Page size (the handler clamps this, so the repo trusts it). */
  limit: number;
}

export interface ListTasksResult {
  items: Task[];
  /**
   * The raw `createdAt` of the last item returned when a next page
   * exists, or `null` if this was the final page. The handler encodes
   * this as the opaque `nextCursor` the client sees.
   */
  nextCursorRaw: string | null;
}

export class TaskRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: TaskRow): Task {
    const task: Task = {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
    };
    if (row.description !== null) {
      task.description = row.description;
    }
    return task;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const row: TaskInsert = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: 'todo',
      createdAt: new Date().toISOString(),
    };
    this.db.insert(tasks).values(row).run();
    return this.rowToApi(row as TaskRow);
  }

  async findById(id: string): Promise<Task | null> {
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async list(options: ListTasksOptions): Promise<ListTasksResult> {
    const conditions = [eq(tasks.projectId, options.projectId)];
    if (options.status) conditions.push(eq(tasks.status, options.status));
    if (options.cursorCreatedAt) {
      conditions.push(gt(tasks.createdAt, options.cursorCreatedAt));
    }

    // Fetch one extra row so we can tell whether a next page exists
    // without a second COUNT query.
    const rows = this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.createdAt))
      .limit(options.limit + 1)
      .all();

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const items = page.map((r) => this.rowToApi(r));
    const nextCursorRaw = hasMore ? page[page.length - 1]!.createdAt : null;
    return { items, nextCursorRaw };
  }

  async update(id: string, patch: UpdateTaskInput): Promise<Task | null> {
    const updates: Partial<TaskInsert> = {};
    if (patch.status !== undefined) updates.status = patch.status;
    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }
    const result = this.db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(tasks).where(eq(tasks.id, id)).run();
    return result.changes > 0;
  }

  async clear(): Promise<void> {
    this.db.delete(tasks).run();
  }
}
