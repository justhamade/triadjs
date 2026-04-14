/**
 * Router definition — the entry point consumed by `triad.config.ts`
 * and `src/server.ts`.
 *
 * Three bounded contexts: Auth, Projects, Tasks. Each context declares
 * its own ubiquitous language via `models[]` so `triad validate` can
 * catch cross-context model leakage.
 *
 * Compare this file to `examples/petstore/src/app.ts` — the shape is
 * identical. Swapping the adapter (Fastify → Express) is a server.ts
 * concern, not a router concern. The router is adapter-agnostic.
 */

import { createRouter } from '@triadjs/core';

import { getMe, login, register } from './endpoints/auth.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from './endpoints/projects.js';
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from './endpoints/tasks.js';

import {
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from './schemas/user.js';
import { CreateProject, Project } from './schemas/project.js';
import { CreateTask, Task, TaskPage, UpdateTask } from './schemas/task.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Task Tracker API',
  version: '1.0.0',
  description:
    'Triad reference example #2 — a task tracker demonstrating auth, ownership-based authorization, keyset pagination, nested resources, 204 responses, and the @triadjs/express adapter.',
  servers: [
    { url: 'http://localhost:3100', description: 'Local development' },
  ],
});

router.context(
  'Auth',
  {
    description: 'User registration, login, and identity.',
    models: [User, RegisterInput, LoginInput, AuthResult, ApiError],
  },
  (ctx) => {
    ctx.add(register, login, getMe);
  },
);

router.context(
  'Projects',
  {
    description: 'Projects owned by the authenticated user.',
    models: [Project, CreateProject, ApiError],
  },
  (ctx) => {
    ctx.add(createProject, listProjects, getProject, deleteProject);
  },
);

router.context(
  'Tasks',
  {
    description: 'Tasks nested under projects, with keyset pagination.',
    models: [
      // Tasks reach into the Projects context for ownership checks,
      // so Project shows up here as a cross-boundary read. Listing
      // it keeps `triad validate` happy.
      Project,
      Task,
      CreateTask,
      UpdateTask,
      TaskPage,
      ApiError,
    ],
  },
  (ctx) => {
    ctx.add(createTask, listTasks, updateTask, deleteTask);
  },
);

export default router;
