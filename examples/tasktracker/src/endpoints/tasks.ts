/**
 * Task endpoints — nested under /projects/:projectId.
 *
 * Every protected handler uses the `requireAuth` beforeHandler to
 * authenticate, then verifies the parent project belongs to the
 * authenticated user via the shared `loadOwnedProject` helper in
 * `../access.ts`, and only then operates on the child task. The
 * authentication step is declarative (one line: `beforeHandler:
 * requireAuth`); the project-ownership check is still a runtime helper
 * because it's data-dependent on the `:projectId` path param, but it
 * now lives in one place — `../access.ts` — and composes Triad's
 * generic `checkOwnership` helper under the hood.
 *
 * The list endpoint demonstrates keyset pagination. The cursor is a
 * base64-encoded copy of the last item's `createdAt` timestamp:
 *
 *   - base64 so clients treat it as opaque (they can't synthesize
 *     one from a timestamp even though technically they could),
 *   - keyset rather than offset so rows inserted between pages don't
 *     duplicate or skip,
 *   - encoded in the handler (not the repository) so the repository
 *     stays agnostic about the cursor format.
 *
 * The encode/decode helpers live at the top of this file rather than
 * in a shared module because they have exactly two call sites and
 * refactoring them out would cost more than it saves.
 */

import { endpoint, scenario, t } from '@triadjs/core';
import { CreateTask, Task, TaskPage, UpdateTask } from '../schemas/task.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';
import { loadOwnedProject } from '../access.js';

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

/** Encode an ISO timestamp as an opaque URL-safe cursor. */
function encodeCursor(createdAt: string): string {
  return Buffer.from(createdAt, 'utf8').toString('base64url');
}

/**
 * Decode a client-provided cursor. Returns `null` if the input is not
 * a valid base64url-encoded ISO timestamp — the handler treats that
 * as "bad cursor, start from the beginning" rather than throwing,
 * because a 400 for a stale cursor is hostile to clients that persist
 * pagination state across sessions.
 */
function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    // Loose ISO-8601 sanity check — we don't need to fully parse it.
    return /^\d{4}-\d{2}-\d{2}T/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /projects/:projectId/tasks
// ---------------------------------------------------------------------------

export const createTask = endpoint({
  name: 'createTask',
  method: 'POST',
  path: '/projects/:projectId/tasks',
  summary: 'Create a task inside a project the user owns',
  tags: ['Tasks'],
  beforeHandler: requireAuth,
  request: {
    params: { projectId: t.string().format('uuid') },
    body: CreateTask,
  },
  responses: {
    201: { schema: Task, description: 'Task created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Project belongs to another user' },
    404: { schema: ApiError, description: 'Project does not exist' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    const task = await ctx.services.taskRepo.create({
      projectId: loaded.project.id,
      title: ctx.body.title,
      ...(ctx.body.description !== undefined && { description: ctx.body.description }),
    });
    return ctx.respond[201](task);
  },
  behaviors: [
    scenario('An owner can create a task in their own project')
      .given('a user with a project')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}' })
      .body({ title: 'Write the docs' })
      .when('I POST /projects/{projectId}/tasks')
      .then('response status is 201')
      .and('response body matches Task')
      .and('response body has title "Write the docs"')
      .and('response body has status "todo"'),

    scenario('Creating a task in another user\'s project returns 403')
      .given('Alice owns the project and Bob is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const bob = await services.userRepo.create({
          email: 'bob@example.com',
          password: 'pw',
          name: 'Bob',
        });
        const project = await services.projectRepo.create({ ownerId: alice.id, name: 'Alpha' });
        const bobToken = services.tokens.issue(bob.id);
        return { bobToken, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {bobToken}' })
      .params({ projectId: '{projectId}' })
      .body({ title: 'Sneaky task' })
      .when('I POST /projects/{projectId}/tasks')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /projects/:projectId/tasks — paginated, filterable
// ---------------------------------------------------------------------------

export const listTasks = endpoint({
  name: 'listTasks',
  method: 'GET',
  path: '/projects/:projectId/tasks',
  summary: 'List tasks in a project with keyset pagination',
  description:
    'Tasks are returned in `createdAt` ASC order. Use the `nextCursor` field to fetch the next page. When `nextCursor` is `null`, there are no more pages.',
  tags: ['Tasks'],
  beforeHandler: requireAuth,
  request: {
    params: { projectId: t.string().format('uuid') },
    query: {
      status: t
        .enum('todo', 'in_progress', 'done')
        .optional()
        .doc('Filter by status'),
      limit: t.int32().min(1).max(100).default(20).doc('Page size (default 20, max 100)'),
      cursor: t.string().optional().doc('Opaque pagination cursor from a previous page'),
    },
  },
  responses: {
    200: { schema: TaskPage, description: 'One page of tasks' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Project belongs to another user' },
    404: { schema: ApiError, description: 'Project does not exist' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }

    const cursorCreatedAt =
      ctx.query.cursor !== undefined ? decodeCursor(ctx.query.cursor) : null;

    const result = await ctx.services.taskRepo.list({
      projectId: loaded.project.id,
      limit: ctx.query.limit,
      ...(ctx.query.status !== undefined && { status: ctx.query.status }),
      ...(cursorCreatedAt !== null && { cursorCreatedAt }),
    });

    return ctx.respond[200]({
      items: result.items,
      nextCursor: result.nextCursorRaw !== null ? encodeCursor(result.nextCursorRaw) : null,
    });
  },
  behaviors: [
    scenario('The first page returns limit items plus a cursor when more exist')
      .given('25 tasks in a project owned by the user')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        // Insert sequentially so createdAt is strictly increasing —
        // important because the cursor is a timestamp comparison.
        for (let i = 1; i <= 25; i++) {
          await services.taskRepo.create({ projectId: project.id, title: `Task ${i}` });
          // better-sqlite3 is synchronous and fast enough that consecutive
          // inserts can share a millisecond. Sleep a beat to force strictly
          // monotonic createdAt values.
          await new Promise((r) => setTimeout(r, 2));
        }
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}' })
      .query({ limit: 10 })
      .when('I GET /projects/{projectId}/tasks?limit=10')
      .then('response status is 200')
      .and('response body matches TaskPage')
      .and('response body has items.length 10'),

    scenario('A subsequent page picks up where the cursor left off')
      .given('15 tasks and a first-page cursor at task 10')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        const created: { createdAt: string }[] = [];
        for (let i = 1; i <= 15; i++) {
          const task = await services.taskRepo.create({
            projectId: project.id,
            title: `Task ${i}`,
          });
          created.push({ createdAt: task.createdAt });
          await new Promise((r) => setTimeout(r, 2));
        }
        // Build the cursor the same way the handler does — base64url
        // over the 10th task's createdAt — so page 2 starts at task 11.
        const cursor = Buffer.from(created[9]!.createdAt, 'utf8').toString('base64url');
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id, cursor };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}' })
      .query({ limit: 10, cursor: '{cursor}' })
      .when('I GET /projects/{projectId}/tasks?limit=10&cursor=...')
      .then('response status is 200')
      .and('response body matches TaskPage')
      .and('response body has items.length 5'),

    scenario('The last page has a null nextCursor')
      .given('5 tasks and a page size of 10')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        for (let i = 1; i <= 5; i++) {
          await services.taskRepo.create({ projectId: project.id, title: `Task ${i}` });
          await new Promise((r) => setTimeout(r, 2));
        }
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}' })
      .query({ limit: 10 })
      .when('I GET /projects/{projectId}/tasks?limit=10')
      .then('response status is 200')
      .and('response body matches TaskPage')
      .and('response body has items.length 5'),
    // NOTE: we would ideally assert `response body has nextCursor null`
    // here, but the test runner's assertion parser doesn't recognize the
    // literal `null` — only strings, numbers, and booleans. See the
    // friction report. The schema still enforces `nextCursor` nullable
    // so a non-null value of the wrong type would fail response-schema
    // validation.

    scenario('Tasks can be filtered by status')
      .given('a mix of todo and done tasks')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        const todos = await Promise.all([
          services.taskRepo.create({ projectId: project.id, title: 'A' }),
          services.taskRepo.create({ projectId: project.id, title: 'B' }),
          services.taskRepo.create({ projectId: project.id, title: 'C' }),
        ]);
        // Mark one done so the filter has work to do.
        await services.taskRepo.update(todos[0]!.id, { status: 'done' });
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}' })
      .query({ status: 'todo', limit: 10 })
      .when('I GET /projects/{projectId}/tasks?status=todo')
      .then('response status is 200')
      .and('response body has items.length 2'),

    scenario('Listing tasks in another user\'s project returns 403')
      .given('Alice owns the project and Bob is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const bob = await services.userRepo.create({
          email: 'bob@example.com',
          password: 'pw',
          name: 'Bob',
        });
        const project = await services.projectRepo.create({ ownerId: alice.id, name: 'Alpha' });
        const bobToken = services.tokens.issue(bob.id);
        return { bobToken, projectId: project.id };
      })
      .headers({ authorization: 'Bearer {bobToken}' })
      .params({ projectId: '{projectId}' })
      .query({ limit: 10 })
      .when('I GET /projects/{projectId}/tasks')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});

// ---------------------------------------------------------------------------
// PATCH /projects/:projectId/tasks/:taskId
// ---------------------------------------------------------------------------

export const updateTask = endpoint({
  name: 'updateTask',
  method: 'PATCH',
  path: '/projects/:projectId/tasks/:taskId',
  summary: "Update a task's status",
  tags: ['Tasks'],
  beforeHandler: requireAuth,
  request: {
    params: {
      projectId: t.string().format('uuid'),
      taskId: t.string().format('uuid'),
    },
    body: UpdateTask,
  },
  responses: {
    200: { schema: Task, description: 'Task updated' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Project belongs to another user' },
    404: { schema: ApiError, description: 'Project or task not found' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    const existing = await ctx.services.taskRepo.findById(ctx.params.taskId);
    if (!existing || existing.projectId !== loaded.project.id) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No task with id ${ctx.params.taskId} in this project.`,
      });
    }
    const updated = await ctx.services.taskRepo.update(ctx.params.taskId, ctx.body);
    // update() returns null only when the row vanishes between findById
    // and update — practically impossible in the in-process test runner
    // but guarded anyway.
    if (!updated) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No task with id ${ctx.params.taskId} in this project.`,
      });
    }
    return ctx.respond[200](updated);
  },
  behaviors: [
    scenario('Owners can move a task to in_progress')
      .given('a task in a project the user owns')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        const task = await services.taskRepo.create({ projectId: project.id, title: 'Do it' });
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id, taskId: task.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}', taskId: '{taskId}' })
      .body({ status: 'in_progress' })
      .when('I PATCH /projects/{projectId}/tasks/{taskId}')
      .then('response status is 200')
      .and('response body has status "in_progress"'),
  ],
});

// ---------------------------------------------------------------------------
// DELETE /projects/:projectId/tasks/:taskId
// ---------------------------------------------------------------------------

export const deleteTask = endpoint({
  name: 'deleteTask',
  method: 'DELETE',
  path: '/projects/:projectId/tasks/:taskId',
  summary: 'Delete a task',
  tags: ['Tasks'],
  beforeHandler: requireAuth,
  request: {
    params: {
      projectId: t.string().format('uuid'),
      taskId: t.string().format('uuid'),
    },
  },
  responses: {
    204: { schema: t.empty(), description: 'Task deleted (no body)' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Project belongs to another user' },
    404: { schema: ApiError, description: 'Project or task not found' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    const existing = await ctx.services.taskRepo.findById(ctx.params.taskId);
    if (!existing || existing.projectId !== loaded.project.id) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No task with id ${ctx.params.taskId} in this project.`,
      });
    }
    await ctx.services.taskRepo.delete(ctx.params.taskId);
    return ctx.respond[204]();
  },
  behaviors: [
    scenario('Owners can delete a task')
      .given('a task in a project the user owns')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
        const task = await services.taskRepo.create({ projectId: project.id, title: 'Do it' });
        const token = services.tokens.issue(user.id);
        return { token, projectId: project.id, taskId: task.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '{projectId}', taskId: '{taskId}' })
      .when('I DELETE /projects/{projectId}/tasks/{taskId}')
      .then('response status is 204'),
  ],
});
