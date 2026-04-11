/**
 * End-to-end auth flow tests for the tasktracker example.
 *
 * Runs against a real Express server via Node `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eHarness } from './setup.js';

describe('tasktracker auth e2e', () => {
  let harness: E2eHarness;

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('POST /auth/register returns 201 with a token and a user', async () => {
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'correct-horse',
        name: 'Alice',
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      token: string;
      user: { id: string; email: string; name: string };
    };
    expect(body.token).toMatch(/^[0-9a-f-]+$/);
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.name).toBe('Alice');
  });

  it('POST /auth/register returns 409 on duplicate email', async () => {
    const payload = {
      email: 'alice@example.com',
      password: 'correct-horse',
      name: 'Alice',
    };
    const first = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    await first.json();

    const second = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, name: 'Another Alice' }),
    });
    expect(second.status).toBe(409);
    const errBody = (await second.json()) as { code: string };
    expect(errBody.code).toBe('EMAIL_IN_USE');
  });

  it('POST /auth/login exchanges credentials for a fresh token', async () => {
    const registerResp = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'correct-horse',
        name: 'Alice',
      }),
    });
    expect(registerResp.status).toBe(201);
    const registered = (await registerResp.json()) as { token: string };

    const loginResp = await fetch(`${harness.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'correct-horse',
      }),
    });
    expect(loginResp.status).toBe(200);
    const loggedIn = (await loginResp.json()) as { token: string };
    expect(loggedIn.token).toMatch(/^[0-9a-f-]+$/);
    // Login rotates the token, so the new one should differ from
    // the registration-time token.
    expect(loggedIn.token).not.toBe(registered.token);
  });

  it('POST /auth/login returns 401 on wrong password', async () => {
    await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'correct-horse',
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
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /me returns the authenticated user', async () => {
    const registerResp = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'correct-horse',
        name: 'Alice',
      }),
    });
    const { token } = (await registerResp.json()) as { token: string };

    const meResp = await fetch(`${harness.baseUrl}/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meResp.status).toBe(200);
    const me = (await meResp.json()) as { email: string; name: string };
    expect(me.email).toBe('alice@example.com');
    expect(me.name).toBe('Alice');
  });

  it('GET /me returns 401 without a token', async () => {
    const response = await fetch(`${harness.baseUrl}/me`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});
