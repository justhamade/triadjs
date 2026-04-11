/**
 * End-to-end auth flow tests for the bookshelf example (Fastify).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eHarness } from './setup.js';

describe('bookshelf auth e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /auth/register issues a token', async () => {
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'pw1234',
        name: 'Alice',
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      token: string;
      user: { email: string; name: string };
    };
    expect(body.user.email).toBe('alice@example.com');
    expect(body.token).toMatch(/^[0-9a-f-]+$/);
  });

  it('POST /auth/login returns a fresh token', async () => {
    await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'pw1234',
        name: 'Alice',
      }),
    });
    const response = await fetch(`${harness.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'pw1234' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body.token).toMatch(/^[0-9a-f-]+$/);
  });

  it('POST /auth/login returns 401 for wrong password', async () => {
    await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'pw1234',
        name: 'Alice',
      }),
    });
    const response = await fetch(`${harness.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'wrong-password',
      }),
    });
    expect(response.status).toBe(401);
  });

  it('GET /me returns the authenticated user', async () => {
    const reg = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'pw1234',
        name: 'Alice',
      }),
    });
    const { token } = (await reg.json()) as { token: string };
    const response = await fetch(`${harness.baseUrl}/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { email: string };
    expect(body.email).toBe('alice@example.com');
  });

  it('GET /me returns 401 without a token', async () => {
    const response = await fetch(`${harness.baseUrl}/me`);
    expect(response.status).toBe(401);
  });
});
