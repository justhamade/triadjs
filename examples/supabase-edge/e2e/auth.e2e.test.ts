/**
 * End-to-end auth verifier tests for the supabase-edge example.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, seedUser, startE2eServer, type E2eHarness } from './setup.js';

describe('supabase-edge auth e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('GET /me returns the authenticated user', async () => {
    const token = seedUser(harness, ALICE);
    const response = await fetch(`${harness.baseUrl}/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { email: string; name: string };
    expect(body.email).toBe(ALICE.email);
    expect(body.name).toBe(ALICE.name);
  });

  it('GET /me returns 401 without a token', async () => {
    const response = await fetch(`${harness.baseUrl}/me`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('GET /me returns 401 for an unknown token', async () => {
    const response = await fetch(`${harness.baseUrl}/me`, {
      headers: { authorization: 'Bearer test-not-a-real-token' },
    });
    expect(response.status).toBe(401);
  });
});
