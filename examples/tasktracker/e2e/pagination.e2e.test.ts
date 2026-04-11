/**
 * End-to-end pagination walk — create 25 tasks and page through them
 * with the real keyset cursor through a real HTTP server.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

interface Page {
  items: Array<{ id: string; title: string }>;
  nextCursor: string | null;
}

describe('tasktracker pagination e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('walks 25 tasks across three pages of 10', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    for (let i = 1; i <= 25; i++) {
      await harness.services.taskRepo.create({
        projectId: project.id,
        title: `Task ${i}`,
      });
      // Force monotonic createdAt timestamps — the keyset cursor is
      // a timestamp comparison and better-sqlite3 is fast enough that
      // consecutive inserts can otherwise share a millisecond.
      await new Promise((r) => setTimeout(r, 2));
    }

    async function getPage(cursor?: string): Promise<Page> {
      const q = new URLSearchParams({ limit: '10' });
      if (cursor !== undefined) q.set('cursor', cursor);
      const response = await fetch(
        `${harness.baseUrl}/projects/${project.id}/tasks?${q.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Page;
    }

    const first = await getPage();
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();

    const second = await getPage(first.nextCursor ?? undefined);
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).not.toBeNull();

    const third = await getPage(second.nextCursor ?? undefined);
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();

    // No item should appear twice.
    const ids = [...first.items, ...second.items, ...third.items].map(
      (t) => t.id,
    );
    expect(new Set(ids).size).toBe(25);
  });

  it('returns an empty page for an empty project', async () => {
    const { token, userId } = await seedUser(harness);
    const project = await harness.services.projectRepo.create({
      ownerId: userId,
      name: 'Alpha',
    });
    const response = await fetch(
      `${harness.baseUrl}/projects/${project.id}/tasks?limit=10`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Page;
    expect(body.items).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });
});
