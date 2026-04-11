/**
 * End-to-end project CRUD tests for the tasktracker example.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('tasktracker projects e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /projects creates a project for the authenticated user', async () => {
    const { token, userId } = await seedUser(harness);
    const response = await fetch(`${harness.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Website redesign' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { name: string; ownerId: string };
    expect(body.name).toBe('Website redesign');
    expect(body.ownerId).toBe(userId);
  });

  it('GET /projects lists only the caller’s own projects', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    await harness.services.projectRepo.create({
      ownerId: alice.userId,
      name: "Alice's project",
    });
    await harness.services.projectRepo.create({
      ownerId: bob.userId,
      name: "Bob's project",
    });

    const response = await fetch(`${harness.baseUrl}/projects`, {
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe("Alice's project");
  });

  it('GET /projects/:id returns 200 for the owner', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const response = await fetch(`${harness.baseUrl}/projects/${project.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string };
    expect(body.name).toBe('Alpha');
  });

  it('DELETE /projects/:id returns 204 and removes the project', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const response = await fetch(`${harness.baseUrl}/projects/${project.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(204);

    const after = await harness.services.projectRepo.findById(project.id);
    expect(after).toBeNull();
  });
});
