/**
 * Project schemas — the Projects bounded context.
 *
 * A project is owned by exactly one user and scopes a collection of
 * tasks. `Project` is the canonical response shape; `CreateProject`
 * is derived via `.pick()` so project fields have a single source of
 * truth.
 *
 * Note that `ownerId` is NOT exposed as a client-writable field on
 * `CreateProject` — ownership is derived from the authenticated user
 * at request time, not taken from the body. This is the same reason
 * petstore's `Pet` doesn't expose `createdAt` on `CreatePet`: fields
 * the server controls should never come from the client.
 */

import { t } from '@triadjs/core';

export const Project = t.model('Project', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique project identifier'),
  ownerId: t
    .string()
    .format('uuid')
    .storage({ references: 'users.id', indexed: true })
    .doc('The user who owns this project'),
  name: t.string().minLength(1).maxLength(120).doc('Project name'),
  description: t.string().maxLength(1000).optional().doc('Optional long-form description'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true })
    .doc('When the project was created'),
});

/** Input for POST /projects — the client only supplies user-controlled fields. */
export const CreateProject = Project.pick('name', 'description').named('CreateProject');
