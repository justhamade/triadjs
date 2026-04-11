/**
 * End-to-end tests for authorization boundaries — 401 without a token,
 * 403 when touching another user's resources.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('tasktracker forbidden e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /projects without a token returns 401', async () => {
    const response = await fetch(`${harness.baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('GET /projects/:id returns 403 when the project belongs to another user', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    const project = await harness.services.projectRepo.create({
      ownerId: alice.userId,
      name: 'Alpha',
    });

    const response = await fetch(`${harness.baseUrl}/projects/${project.id}`, {
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('POST /projects/:id/tasks returns 403 for non-owners', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    const project = await harness.services.projectRepo.create({
      ownerId: alice.userId,
      name: 'Alpha',
    });
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bob.token}`,
        },
        body: JSON.stringify({ title: 'Sneaky task' }),
      },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('GET /projects/:id returns 404 for an unknown id', async () => {
    const { token } = await seedUser(harness);
    const response = await fetch(
      `${harness.baseUrl}/projects/00000000-0000-0000-0000-000000000000`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});
