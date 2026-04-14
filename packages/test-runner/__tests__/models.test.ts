import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import { collectModels } from '../src/models.js';

describe('collectModels', () => {
  const Pet = t.model('Pet', {
    id: t.string().format('uuid'),
    name: t.string(),
  });
  const CreatePet = Pet.pick('name').named('CreatePet');
  const ApiError = t.model('ApiError', {
    code: t.string(),
    message: t.string(),
  });
  const Owner = t.model('Owner', {
    id: t.string().format('uuid'),
    pet: Pet,
  });

  it('collects top-level request and response models', () => {
    const ep = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'x',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'ok' },
        400: { schema: ApiError, description: 'err' },
      },
      handler: async (ctx) =>
        ctx.respond[201]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: ctx.body.name,
        }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const models = collectModels(router);
    expect(models.has('Pet')).toBe(true);
    expect(models.has('CreatePet')).toBe(true);
    expect(models.has('ApiError')).toBe(true);
  });

  it('recurses into nested model fields', () => {
    const ep = endpoint({
      name: 'getOwner',
      method: 'GET',
      path: '/owners/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Owner, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const models = collectModels(router);
    expect(models.has('Owner')).toBe(true);
    expect(models.has('Pet')).toBe(true); // nested
  });

  it('recurses into array items', () => {
    const ep = endpoint({
      name: 'listPets',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: t.array(Pet), description: 'ok' } },
      handler: async () => ({ status: 200, body: [] }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const models = collectModels(router);
    expect(models.has('Pet')).toBe(true);
  });

  it('recurses into union options', () => {
    const ep = endpoint({
      name: 'petOrError',
      method: 'GET',
      path: '/thing',
      summary: 'x',
      responses: {
        200: { schema: t.union(Pet, ApiError), description: 'ok' },
      },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const models = collectModels(router);
    expect(models.has('Pet')).toBe(true);
    expect(models.has('ApiError')).toBe(true);
  });

  it('registers each model exactly once even when referenced many times', () => {
    const ep1 = endpoint({
      name: 'a',
      method: 'GET',
      path: '/a',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const ep2 = endpoint({
      name: 'b',
      method: 'GET',
      path: '/b',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);

    const models = collectModels(router);
    // Pet should be in the registry, but only once (Map dedup)
    expect(models.get('Pet')).toBe(Pet);
  });
});
