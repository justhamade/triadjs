/**
 * Task schemas — the Tasks bounded context.
 *
 * Tasks are nested under projects: every task belongs to exactly one
 * project and inherits its ownership from the parent. The API reflects
 * that nesting in the URL (`/projects/:projectId/tasks/:taskId`) rather
 * than flattening tasks to a top-level resource. This is a conscious
 * choice to stress-test Triad's typed-params support against a two-
 * segment path.
 *
 * `TaskPage` is the pagination envelope for `GET /projects/:projectId/
 * tasks`. It wraps the array of tasks in an object that also carries
 * `nextCursor`, giving clients a stable shape to parse even when there
 * are no items. `nextCursor` is a base64-encoded copy of the last
 * item's `createdAt` — a simple keyset cursor that is cheap to encode,
 * resilient to new inserts between pages, and honest about what
 * "pagination" means in practice. Offset pagination would duplicate
 * results when rows are created concurrently; keyset pagination avoids
 * that.
 */

import { t } from '@triadjs/core';

export const TaskStatus = t
  .enum('todo', 'in_progress', 'done')
  .doc('Task lifecycle status');

export const Task = t.model('Task', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique task identifier'),
  projectId: t
    .string()
    .format('uuid')
    .storage({ references: 'projects.id', indexed: true })
    .doc('The project this task belongs to'),
  title: t.string().minLength(1).maxLength(200).doc('Short task title'),
  description: t.string().maxLength(2000).optional().doc('Optional long-form description'),
  status: t
    .enum('todo', 'in_progress', 'done')
    .storage({ indexed: true })
    .doc('Task lifecycle status')
    .default('todo'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, indexed: true })
    .doc('Creation timestamp — also used as the keyset pagination cursor'),
});

/** Input for POST /projects/:projectId/tasks — user-supplied fields only. */
export const CreateTask = Task.pick('title', 'description').named('CreateTask');

/**
 * Input for PATCH /projects/:projectId/tasks/:taskId — currently only
 * status is mutable. Deriving it via `.pick().partial()` means adding
 * a new mutable field is a one-line schema change.
 */
export const UpdateTask = Task.pick('status').partial().named('UpdateTask');

/**
 * Pagination envelope. `nextCursor` is `null` on the last page so
 * clients can safely loop `while (page.nextCursor !== null)` without
 * counting items or reading HTTP headers.
 */
export const TaskPage = t.model('TaskPage', {
  items: t.array(Task).doc('The tasks on this page, ordered by createdAt ASC'),
  nextCursor: t
    .string()
    .nullable()
    .doc('Opaque cursor. Pass it back as ?cursor=<value> to fetch the next page. `null` on the last page.'),
});
