/**
 * End-to-end tests for the Pets bounded context.
 *
 * Exercises POST/GET/PATCH against a real Fastify server with a real
 * better-sqlite3 backing store, using Node's built-in `fetch` as the
 * HTTP client. Each `it` block gets a fresh server + fresh DB via
 * `beforeEach`, so assertions never leak state across tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eHarness } from './setup.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('pets e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('creates a pet via POST /pets and returns 201 with a UUID', async () => {
    const response = await fetch(`${harness.baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = (await response.json()) as {
      id: string;
      name: string;
      species: string;
      age: number;
      status: string;
    };
    expect(body.name).toBe('Rex');
    expect(body.species).toBe('dog');
    expect(body.age).toBe(3);
    expect(body.status).toBe('available');
    expect(body.id).toMatch(UUID);
  });

  it('rejects duplicate pets in the same species with 409', async () => {
    const make = () =>
      fetch(`${harness.baseUrl}/pets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Buddy', species: 'dog', age: 2 }),
      });
    const first = await make();
    expect(first.status).toBe(201);
    await first.json();

    const second = await make();
    expect(second.status).toBe(409);
    const errBody = (await second.json()) as { code: string; message: string };
    expect(errBody.code).toBe('DUPLICATE_PET');
  });

  it('allows the same pet name in different species', async () => {
    const first = await fetch(`${harness.baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Whiskers', species: 'dog', age: 4 }),
    });
    expect(first.status).toBe(201);
    await first.json();

    const second = await fetch(`${harness.baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Whiskers', species: 'cat', age: 2 }),
    });
    expect(second.status).toBe(201);
    const body = (await second.json()) as { species: string };
    expect(body.species).toBe('cat');
  });

  it('GET /pets/:id returns an existing pet', async () => {
    const pet = await harness.services.petRepo.create({
      name: 'Milo',
      species: 'cat',
      age: 2,
    });
    const response = await fetch(`${harness.baseUrl}/pets/${pet.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.id).toBe(pet.id);
    expect(body.name).toBe('Milo');
  });

  it('GET /pets/:id returns 404 for unknown ids', async () => {
    const response = await fetch(
      `${harness.baseUrl}/pets/00000000-0000-0000-0000-000000000000`,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('GET /pets lists all pets with no filter', async () => {
    await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    await harness.services.petRepo.create({
      name: 'Whiskers',
      species: 'cat',
      age: 3,
    });
    const response = await fetch(`${harness.baseUrl}/pets`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('GET /pets?species=dog filters by species', async () => {
    await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    await harness.services.petRepo.create({
      name: 'Buddy',
      species: 'dog',
      age: 2,
    });
    await harness.services.petRepo.create({
      name: 'Whiskers',
      species: 'cat',
      age: 3,
    });
    const response = await fetch(`${harness.baseUrl}/pets?species=dog`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ species: string }>;
    expect(body).toHaveLength(2);
    for (const pet of body) {
      expect(pet.species).toBe('dog');
    }
  });

  it('PATCH /pets/:id updates an existing pet', async () => {
    const pet = await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    const response = await fetch(`${harness.baseUrl}/pets/${pet.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ age: 6 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { age: number };
    expect(body.age).toBe(6);
  });

  it('PATCH /pets/:id returns 404 for unknown ids', async () => {
    const response = await fetch(
      `${harness.baseUrl}/pets/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ age: 7 }),
      },
    );
    expect(response.status).toBe(404);
  });
});
