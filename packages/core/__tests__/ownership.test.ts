import { describe, expect, it } from 'vitest';
import { checkOwnership } from '../src/ownership.js';

interface Project {
  id: string;
  ownerId: string;
  name: string;
}

const alice = 'alice';
const bob = 'bob';
const project: Project = { id: 'p1', ownerId: alice, name: 'Alpha' };

describe('checkOwnership', () => {
  it('returns not_found when the entity is null', () => {
    const result = checkOwnership<Project>(null, alice, (p) => p.ownerId);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when the entity is undefined', () => {
    const result = checkOwnership<Project>(undefined, alice, (p) => p.ownerId);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns forbidden when the owner does not match', () => {
    const result = checkOwnership(project, bob, (p) => p.ownerId);
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('returns ok with the entity when the owner matches', () => {
    const result = checkOwnership(project, alice, (p) => p.ownerId);
    expect(result).toEqual({ ok: true, entity: project });
  });

  it('distinguishes not_found from forbidden (does not collapse)', () => {
    const missing = checkOwnership<Project>(null, bob, (p) => p.ownerId);
    const foreign = checkOwnership(project, bob, (p) => p.ownerId);
    expect(missing).not.toEqual(foreign);
  });

  it('supports nested getters', () => {
    interface Task {
      id: string;
      project: { ownerId: string };
    }
    const task: Task = { id: 't1', project: { ownerId: alice } };
    const result = checkOwnership(task, alice, (t) => t.project.ownerId);
    expect(result.ok).toBe(true);
  });

  it('narrows the success type for callers via the discriminant', () => {
    const result = checkOwnership(project, alice, (p) => p.ownerId);
    if (result.ok) {
      // Compile-time check: result.entity is Project, not Project | null
      expect(result.entity.name).toBe('Alpha');
    } else {
      throw new Error('unreachable');
    }
  });
});
