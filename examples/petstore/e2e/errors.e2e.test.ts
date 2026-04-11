/**
 * End-to-end tests that exercise the error envelope shape.
 *
 * Validation errors, malformed JSON, unknown routes, and schema
 * violations all need to arrive at the client with a consistent
 * structure. These tests run against a real HTTP socket so any
 * adapter-side middleware quirk would surface here and not in the
 * in-process `triad test` runs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eHarness } from './setup.js';

describe('petstore error envelopes e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('returns 400 for missing required fields', async () => {
    const response = await fetch(`${harness.baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Missing `species` and `age`.
      body: JSON.stringify({ name: 'Rex' }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { code?: string; message?: string };
    // The error envelope has at minimum a code string.
    expect(typeof body.code === 'string' || typeof body.message === 'string').toBe(
      true,
    );
  });

  it('returns 400 for an invalid species enum', async () => {
    const response = await fetch(`${harness.baseUrl}/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rex', species: 'dragon', age: 3 }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a non-UUID path param', async () => {
    const response = await fetch(`${harness.baseUrl}/pets/not-a-uuid`);
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown route', async () => {
    const response = await fetch(`${harness.baseUrl}/nonexistent`);
    expect(response.status).toBe(404);
  });
});
