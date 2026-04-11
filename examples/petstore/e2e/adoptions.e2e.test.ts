/**
 * End-to-end tests for the Adoption bounded context.
 *
 * Walks through the full adoption workflow — create adopter, request
 * adoption, complete adoption — against a real Fastify server with a
 * real SQLite database.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eHarness } from './setup.js';

describe('adoptions e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /adopters registers an adopter', async () => {
    const response = await fetch(`${harness.baseUrl}/adopters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    expect(body.name).toBe('Alice');
    expect(body.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('walks the full adoption lifecycle via HTTP', async () => {
    // 1. Create a pet and an adopter via the services container (pure
    //    data setup — not part of the assertion surface).
    const pet = await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    const adopter = await harness.services.adopterRepo.create({
      name: 'Alice',
      email: 'alice@example.com',
    });

    // 2. Request adoption via HTTP — this is the assertion surface.
    const requestResponse = await fetch(
      `${harness.baseUrl}/pets/${pet.id}/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adopterId: adopter.id }),
      },
    );
    expect(requestResponse.status).toBe(201);
    const adoption = (await requestResponse.json()) as {
      id: string;
      status: string;
      petId: string;
    };
    expect(adoption.status).toBe('requested');
    expect(adoption.petId).toBe(pet.id);

    // 3. Pet should be pending now.
    const getPet = await fetch(`${harness.baseUrl}/pets/${pet.id}`);
    const petBody = (await getPet.json()) as { status: string };
    expect(petBody.status).toBe('pending');

    // 4. Complete the adoption.
    const completeResponse = await fetch(
      `${harness.baseUrl}/adoptions/${adoption.id}/complete`,
      { method: 'POST' },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as { status: string };
    expect(completed.status).toBe('completed');

    // 5. Pet should now be adopted.
    const getPet2 = await fetch(`${harness.baseUrl}/pets/${pet.id}`);
    const petBody2 = (await getPet2.json()) as { status: string };
    expect(petBody2.status).toBe('adopted');
  });

  it('POST /pets/:id/adopt returns 409 when the pet is already pending', async () => {
    const pet = await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    await harness.services.petRepo.setStatus(pet.id, 'pending');
    const adopter = await harness.services.adopterRepo.create({
      name: 'Alice',
      email: 'alice@example.com',
    });
    const response = await fetch(`${harness.baseUrl}/pets/${pet.id}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adopterId: adopter.id }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('PET_NOT_AVAILABLE');
  });

  it('POST /pets/:id/adopt returns 404 for an unknown adopter', async () => {
    const pet = await harness.services.petRepo.create({
      name: 'Rex',
      species: 'dog',
      age: 5,
    });
    const response = await fetch(`${harness.baseUrl}/pets/${pet.id}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        adopterId: '00000000-0000-0000-0000-000000000000',
      }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('ADOPTER_NOT_FOUND');
  });
});
