/**
 * Project endpoints.
 *
 * As of Phase 10.3, auth is a declarative `beforeHandler` — every
 * protected endpoint in this file sets `beforeHandler: requireAuth`
 * and then reads `ctx.state.user` directly. No three-line preamble,
 * no `authorization` header declared in the request shape, and the
 * `requireAuth` short-circuit is type-checked against the endpoint's
 * declared 401 response schema.
 *
 * Ownership enforcement is factored into the shared `loadOwnedProject`
 * helper in `../access.ts`, which composes Triad's generic
 * `checkOwnership` with tasktracker's repository shape. Both this
 * file and `endpoints/tasks.ts` import it so the 404 vs 403
 * branching stays identical across contexts — the distinction is
 * intentional: 404 when the project id is unknown globally, 403
 * when it exists but belongs to another user.
 */

import { endpoint, scenario, t } from '@triad/core';
import { CreateProject, Project } from '../schemas/project.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';
import { loadOwnedProject } from '../access.js';

// ---------------------------------------------------------------------------
// POST /projects
// ---------------------------------------------------------------------------

export const createProject = endpoint({
  name: 'createProject',
  method: 'POST',
  path: '/projects',
  summary: 'Create a project owned by the authenticated user',
  tags: ['Projects'],
  beforeHandler: requireAuth,
  request: { body: CreateProject },
  responses: {
    201: { schema: Project, description: 'Project created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const project = await ctx.services.projectRepo.create({
      ownerId: ctx.state.user.id,
      name: ctx.body.name,
      ...(ctx.body.description !== undefined && { description: ctx.body.description }),
    });
    return ctx.respond[201](project);
  },
  behaviors: [
    scenario('An authenticated user can create a project')
      .given('a logged-in user')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const token = services.tokens.issue(user.id);
        return { token, userId: user.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .body({ name: 'Website redesign', description: 'Shipping Q3' })
      .when('I POST /projects')
      .then('response status is 201')
      .and('response body matches Project')
      .and('response body has name "Website redesign"')
      .and('response body has ownerId "{userId}"'),

    scenario('Creating a project without auth returns 401')
      .given('no credentials')
      .body({ name: 'Unauthorized project' })
      .when('I POST /projects')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /projects — the authenticated user's projects
// ---------------------------------------------------------------------------

export const listProjects = endpoint({
  name: 'listProjects',
  method: 'GET',
  path: '/projects',
  summary: "List the authenticated user's projects",
  description: 'Projects are scoped to the authenticated user — a user never sees another user\'s projects.',
  tags: ['Projects'],
  beforeHandler: requireAuth,
  responses: {
    200: { schema: t.array(Project), description: 'Projects owned by the authenticated user' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const projects = await ctx.services.projectRepo.listByOwner(ctx.state.user.id);
    return ctx.respond[200](projects);
  },
  behaviors: [
    scenario('Each user sees only their own projects')
      .given('two users each with one project')
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
        await services.projectRepo.create({ ownerId: alice.id, name: "Alice's project" });
        await services.projectRepo.create({ ownerId: bob.id, name: "Bob's project" });
        const aliceToken = services.tokens.issue(alice.id);
        return { aliceToken };
      })
      .headers({ authorization: 'Bearer {aliceToken}' })
      .when('I GET /projects')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 1'),

    scenario('Listing projects without auth returns 401')
      .given('no credentials')
      .when('I GET /projects')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /projects/:projectId
// ---------------------------------------------------------------------------

export const getProject = endpoint({
  name: 'getProject',
  method: 'GET',
  path: '/projects/:projectId',
  summary: 'Fetch a single project the user owns',
  tags: ['Projects'],
  beforeHandler: requireAuth,
  request: {
    params: { projectId: t.string().format('uuid').doc('The project id') },
  },
  responses: {
    200: { schema: Project, description: 'The project' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'The project belongs to another user' },
    404: { schema: ApiError, description: 'No project with that id' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    return ctx.respond[200](loaded.project);
  },
  behaviors: [
    scenario('Owners can fetch their own project')
      .given('a user and a project they own')
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
      .when('I GET /projects/{projectId}')
      .then('response status is 200')
      .and('response body has name "Alpha"'),

    scenario('A user cannot fetch another user\'s project')
      .given('Alice owns a project and Bob is logged in')
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
      .when('I GET /projects/{projectId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),

    scenario('Fetching an unknown project returns 404')
      .given('a logged-in user and no such project')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const token = services.tokens.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ projectId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /projects/{projectId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),

    scenario('Fetching a project without auth returns 401')
      .given('no credentials')
      .params({ projectId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /projects/{projectId}')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// DELETE /projects/:projectId
// ---------------------------------------------------------------------------

export const deleteProject = endpoint({
  name: 'deleteProject',
  method: 'DELETE',
  path: '/projects/:projectId',
  summary: 'Delete a project the user owns',
  description:
    'Deletes the project and, via ON DELETE CASCADE on the storage schema, every task that belonged to it.',
  tags: ['Projects'],
  beforeHandler: requireAuth,
  request: {
    params: { projectId: t.string().format('uuid').doc('The project id') },
  },
  responses: {
    204: { schema: t.empty(), description: 'Project deleted (no body)' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'The project belongs to another user' },
    404: { schema: ApiError, description: 'No project with that id' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedProject(ctx.services, ctx.params.projectId, ctx.state.user.id);
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    await ctx.services.projectRepo.delete(loaded.project.id);
    return ctx.respond[204]();
  },
  behaviors: [
    scenario('Owners can delete their own project')
      .given('a user and a project they own')
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
      .when('I DELETE /projects/{projectId}')
      .then('response status is 204'),

    scenario('A user cannot delete another user\'s project')
      .given('Alice owns a project and Bob is logged in')
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
      .when('I DELETE /projects/{projectId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});
