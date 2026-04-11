/**
 * End-to-end task CRUD tests nested under projects.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('tasktracker tasks e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /projects/:id/tasks creates a task in the owner’s project', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: 'Write the docs' }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { title: string; status: string };
    expect(body.title).toBe('Write the docs');
    expect(body.status).toBe('todo');
  });

  it('GET /projects/:id/tasks returns the first page with a cursor', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    for (let i = 1; i <= 12; i++) {
      await harness.services.taskRepo.create({
        projectId: project.id,
        title: `Task ${i}`,
      });
      // Ensure strictly monotonic createdAt timestamps so the keyset
      // cursor comparison stays deterministic.
      await new Promise((r) => setTimeout(r, 2));
    }
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks?limit=5`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(5);
    expect(body.nextCursor).not.toBeNull();
  });

  it('PATCH /projects/:pid/tasks/:tid moves a task to in_progress', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const task = await harness.services.taskRepo.create({
      projectId: project.id,
      title: 'Do it',
    });
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks/${task.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'in_progress' }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('in_progress');
  });

  it('DELETE /projects/:pid/tasks/:tid returns 204', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const task = await harness.services.taskRepo.create({
      projectId: project.id,
      title: 'Ephemeral',
    });
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks/${task.id}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(204);
  });

  it('filters tasks by status', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const done = await harness.services.taskRepo.create({
      projectId: project.id,
      title: 'A',
    });
    await harness.services.taskRepo.create({
      projectId: project.id,
      title: 'B',
    });
    await harness.services.taskRepo.create({
      projectId: project.id,
      title: 'C',
    });
    await harness.services.taskRepo.update(done.id, { status: 'done' });

    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks?status=todo&limit=20`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ status: string }>;
    };
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item.status).toBe('todo');
    }
  });
});
