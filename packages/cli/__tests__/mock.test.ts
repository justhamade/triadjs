/**
 * Tests for `triad mock` — a small fake HTTP server that returns
 * schema-valid mock data from the router's response schemas.
 *
 * Covers server behavior (routing, latency, error-rate, seed) against
 * a minimal programmatically-constructed router so the test has no
 * fixture dependency and can run in isolation.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { createRouter, endpoint, t, type Router } from '@triadjs/core';
import { startMockServer, type MockServerHandle } from '../src/commands/mock.js';

function buildRouter(): Router {
  const Pet = t.model('Pet', {
    id: t.string().format('uuid'),
    name: t.string().minLength(1),
  });
  const listPets = endpoint({
    name: 'listPets',
    method: 'GET',
    path: '/pets',
    summary: 'list',
    responses: { 200: { schema: t.array(Pet), description: 'ok' } },
    handler: async () => ({ status: 200, body: [] }),
  });
  const getPet = endpoint({
    name: 'getPet',
    method: 'GET',
    path: '/pets/:id',
    summary: 'get',
    responses: { 200: { schema: Pet, description: 'ok' } },
    handler: async () => ({ status: 200, body: {} }),
  });
  const router = createRouter({ title: 'MockTest', version: '1' });
  router.add(listPets, getPet);
  return router;
}

let server: MockServerHandle | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string; durationMs: number }> {
  const start = Date.now();
  const res = await fetch(url, init);
  const body = await res.text();
  return { status: res.status, body, durationMs: Date.now() - start };
}

describe('triad mock', () => {
  it('responds 200 with schema-valid JSON for a known endpoint', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/pets/abc`);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('name');
    expect(typeof parsed.name).toBe('string');
  });

  it('returns an array for a list endpoint', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/pets`);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('responds 404 for an unknown path', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/nowhere`);
    expect(res.status).toBe(404);
  });

  it('responds 404 when method does not match', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/pets`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('applies --latency before responding', async () => {
    const router = buildRouter();
    server = await startMockServer({
      router,
      port: 0,
      latency: 120,
      quiet: true,
    });
    const res = await fetchText(`${server.url}/pets`);
    expect(res.status).toBe(200);
    expect(res.durationMs).toBeGreaterThanOrEqual(100);
  });

  it('returns 500 when --error-rate is 1', async () => {
    const router = buildRouter();
    server = await startMockServer({
      router,
      port: 0,
      errorRate: 1,
      quiet: true,
    });
    const res = await fetchText(`${server.url}/pets`);
    expect(res.status).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.code).toBe('MOCK_ERROR');
  });

  it('produces identical output across two runs with the same seed', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, seed: 42, quiet: true });
    const a = await fetchText(`${server.url}/pets/abc`);
    await server.close();
    server = await startMockServer({ router, port: 0, seed: 42, quiet: true });
    const b = await fetchText(`${server.url}/pets/abc`);
    expect(a.body).toBe(b.body);
  });

  it('matches path params and still returns a 200', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/pets/12345`);
    expect(res.status).toBe(200);
  });

  it('returns JSON content-type header', async () => {
    const router = buildRouter();
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetch(`${server.url}/pets`);
    expect(res.headers.get('content-type')).toContain('application/json');
    await res.text();
  });

  it('selects the happy-path status code (200 or 201)', async () => {
    const Pet = t.model('PetCreated', { id: t.string() });
    const createPet = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'create',
      responses: {
        201: { schema: Pet, description: 'ok' },
        400: { schema: t.model('Err', { msg: t.string() }), description: 'bad' },
      },
      handler: async () => ({ status: 201, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(createPet);
    server = await startMockServer({ router, port: 0, quiet: true });
    const res = await fetchText(`${server.url}/pets`, { method: 'POST' });
    expect(res.status).toBe(201);
  });
});
