/**
 * Drizzle-backed `ProjectRepository`.
 *
 * Every query takes an `ownerId` parameter where ownership is relevant
 * so the repository is the last line of defense against cross-tenant
 * leaks — even if a handler forgets to check ownership, a malicious
 * `findById` call with the wrong owner will return `null`. This is the
 * "authorization at the repository boundary" pattern; it's not a
 * replacement for handler-level checks (which should still produce
 * correct 403s), but it means a bug in the handler layer can't leak
 * data by accident.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Infer } from '@triadjs/core';
import type { InferRow, InferInsert } from '@triadjs/drizzle';

import type { Db } from '../db/client.js';
import { projects } from '../db/schema.js';
import type { Project as ProjectSchema } from '../schemas/project.js';

type Project = Infer<typeof ProjectSchema>;
type ProjectRow = InferRow<typeof projects>;
type ProjectInsert = InferInsert<typeof projects>;

export interface CreateProjectInput {
  ownerId: string;
  name: string;
  description?: string;
}

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: ProjectRow): Project {
    const project: Project = {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      createdAt: row.createdAt,
    };
    if (row.description !== null) {
      project.description = row.description;
    }
    return project;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const row: ProjectInsert = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(projects).values(row).run();
    return this.rowToApi(row as ProjectRow);
  }

  /**
   * Unscoped lookup — used by the authorization helper to distinguish
   * "project doesn't exist" (404) from "project exists but belongs to
   * another user" (403). Handlers should prefer `findByIdForOwner`
   * when they already know the authenticated user.
   */
  async findById(id: string): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Project | null> {
    const row = this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
      .get();
    return row ? this.rowToApi(row) : null;
  }

  async listByOwner(ownerId: string): Promise<Project[]> {
    const rows = this.db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(asc(projects.createdAt))
      .all();
    return rows.map((r) => this.rowToApi(r));
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(projects).where(eq(projects.id, id)).run();
    return result.changes > 0;
  }

  async clear(): Promise<void> {
    this.db.delete(projects).run();
  }
}
