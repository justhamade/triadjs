/**
 * Service container wiring — one definition, reused by the production
 * entry point (`server.ts`) and the per-scenario test setup
 * (`test-setup.ts`).
 *
 * Heterogeneity by design: user/project/task repositories are backed
 * by Drizzle (SQLite) while `tokens` is an in-memory `TokenStore`.
 * Handlers don't care which storage each service uses — they just
 * call `ctx.services.tokens.issue(...)` the same way they call
 * `ctx.services.projectRepo.findByIdForOwner(...)`.
 *
 * Declaration-merging `ServiceContainer` gives every handler static
 * typing for `ctx.services.*` without manual imports in each endpoint
 * file. That's the "one tax, paid once" that makes the rest of the
 * codebase feel weightless.
 */

import { createDatabase, type Db } from './db/client.js';
import { ProjectRepository } from './repositories/project.js';
import { TaskRepository } from './repositories/task.js';
import { TokenStore } from './repositories/token.js';
import { UserRepository } from './repositories/user.js';

export interface TaskTrackerServices {
  db: Db;
  userRepo: UserRepository;
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  tokens: TokenStore;
}

declare module '@triadjs/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ServiceContainer extends TaskTrackerServices {}
}

export interface CreateServicesOptions {
  /** Provide an existing Drizzle client. If omitted, a fresh in-memory DB is created. */
  db?: Db;
}

export function createServices(
  options: CreateServicesOptions = {},
): TaskTrackerServices {
  const db = options.db ?? createDatabase();
  return {
    db,
    userRepo: new UserRepository(db),
    projectRepo: new ProjectRepository(db),
    taskRepo: new TaskRepository(db),
    tokens: new TokenStore(),
  };
}
