/**
 * Access-control helpers.
 *
 * This module composes Triad's generic `checkOwnership` helper with
 * tasktracker's repository shape to produce a context-specific wrapper
 * that every ownership-scoped endpoint can reuse without duplication.
 *
 * Before Phase 10.4, every endpoint file had its own local
 * `loadOwnedProject` function with identical 404/403 branching. The
 * duplication wasn't harmful — the helper is small — but it was
 * exactly the kind of drift risk Triad is trying to eliminate. Now
 * both `endpoints/projects.ts` and `endpoints/tasks.ts` import from
 * here, and `checkOwnership` guarantees the 404 vs 403 branching is
 * identical across contexts.
 *
 * The generic helper in `@triadjs/core` does not fetch — that's the
 * repository's job. This wrapper handles the fetch-then-check pattern
 * for the `projectRepo` specifically, returning a ready-to-render
 * tuple the caller passes to the right `ctx.respond[...]` slot.
 */

import type { Infer } from '@triadjs/core';
import { checkOwnership } from '@triadjs/core';
import type { Project } from './schemas/project.js';
import type { TaskTrackerServices } from './services.js';

type ProjectValue = Infer<typeof Project>;
type ErrorBody = { code: string; message: string };

export type LoadedProject =
  | { ok: true; project: ProjectValue }
  | { ok: false; status: 404 | 403; error: ErrorBody };

/**
 * Load a project by id and enforce ownership. Returns either the
 * loaded project or a `{ status, error }` tuple the caller passes to
 * the right `ctx.respond[...]` slot.
 *
 * The 404 vs 403 distinction is intentional: we report "not found"
 * when the project id is unknown globally and "forbidden" when it
 * exists but belongs to another user. Collapsing both into 404 is
 * safer from an enumeration standpoint but dishonest about the
 * actual error — apps that prefer the collapsed form can copy this
 * helper and return 404 in the forbidden branch.
 */
export async function loadOwnedProject(
  services: Pick<TaskTrackerServices, 'projectRepo'>,
  projectId: string,
  userId: string,
): Promise<LoadedProject> {
  const project = await services.projectRepo.findById(projectId);
  const result = checkOwnership(project, userId, (p) => p.ownerId);
  if (result.ok) {
    return { ok: true, project: result.entity };
  }
  if (result.reason === 'not_found') {
    return {
      ok: false,
      status: 404,
      error: { code: 'NOT_FOUND', message: `No project with id ${projectId}.` },
    };
  }
  return {
    ok: false,
    status: 403,
    error: { code: 'FORBIDDEN', message: 'You do not own this project.' },
  };
}
