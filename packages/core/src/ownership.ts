/**
 * Ownership check helper.
 *
 * A small, pure function that resolves the two failure modes every
 * ownership-scoped endpoint has to handle: "the entity doesn't exist at
 * all" (404) and "the entity exists but belongs to someone else" (403).
 * Keeping the distinction matters — collapsing both into 404 is safer
 * from an enumeration standpoint but dishonest about the error the
 * client actually hit, and the choice should be made per-project, not
 * imposed by the framework.
 *
 * This helper is deliberately tiny. It does NOT do the fetch — that's
 * the repository's job. It only takes the fetched entity (nullable)
 * and decides which branch the caller should render. Keeping it
 * separate from the fetch means the same helper works against any
 * repository shape (sync, async, cached, multi-tenant, etc.).
 *
 * Typical usage inside a handler:
 *
 *     const result = checkOwnership(
 *       await ctx.services.projectRepo.findById(ctx.params.projectId),
 *       ctx.state.user.id,
 *       (p) => p.ownerId,
 *     );
 *     if (!result.ok) {
 *       return result.reason === 'not_found'
 *         ? ctx.respond[404]({ code: 'NOT_FOUND', message: '...' })
 *         : ctx.respond[403]({ code: 'FORBIDDEN', message: '...' });
 *     }
 *     const project = result.entity;
 *
 * Apps that want a context-specific wrapper can compose on top — see
 * the `loadOwnedProject` helper in `examples/tasktracker/src/access.ts`
 * for a reference pattern.
 */

export type OwnershipResult<T> =
  | { readonly ok: true; readonly entity: T }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' };

export function checkOwnership<T>(
  entity: T | null | undefined,
  ownerId: string,
  getOwnerId: (entity: T) => string,
): OwnershipResult<T> {
  if (entity === null || entity === undefined) {
    return { ok: false, reason: 'not_found' };
  }
  if (getOwnerId(entity) !== ownerId) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, entity };
}
