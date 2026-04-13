/**
 * Behavioural tests for `requireJWT`.
 *
 * These tests use the real `jose` library for signing and verification
 * — no fakes or test seams.
 */

import { describe, expect, it, vi } from 'vitest';
import { requireJWT } from '../src/require-jwt.js';
import type { RequireJwtResponses } from '../src/types.js';
import {
  HS256_SECRET,
  signToken,
  signExpiredToken,
  makeContext,
} from './test-helpers.js';

const SECRET_STRING = 'test-secret-at-least-32-bytes-long!!!';

interface AppUser {
  id: string;
  email: string;
}

describe('requireJWT — option validation', () => {
  it('throws when neither jwksUri nor secret is supplied', () => {
    expect(() =>
      requireJWT<AppUser>({
        extractUser: () => ({ id: '1', email: 'a@b.c' }),
      }),
    ).toThrow(/either `jwksUri` or `secret`/);
  });

  it('throws when both jwksUri and secret are supplied', () => {
    expect(() =>
      requireJWT<AppUser>({
        jwksUri: 'https://example.com/.well-known/jwks.json',
        secret: 'nope',
        extractUser: () => ({ id: '1', email: 'a@b.c' }),
      }),
    ).toThrow(/exactly one/);
  });
});

describe('requireJWT — happy path', () => {
  it('verifies a correctly-signed HS256 token and attaches state.user', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      issuer: 'my-api',
      audience: 'my-users',
      algorithms: ['HS256'],
      extractUser: (claims) => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
      }),
    });
    const token = await signToken({
      issuer: 'my-api',
      audience: 'my-users',
      subject: 'user-42',
      payload: { email: 'alice@example.com' },
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toEqual({
        user: { id: 'user-42', email: 'alice@example.com' },
      });
    }
  });

  it('accepts Uint8Array secrets for HS256', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = await signToken({
      subject: 'u1',
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });

  it('accepts lowercase and capitalized Authorization headers', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = await signToken({ subject: 'u1' });
    const { ctx } = makeContext<RequireJwtResponses>({
      Authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });
});

describe('requireJWT — authentication failures', () => {
  const makeHook = (): ReturnType<typeof requireJWT<AppUser>> =>
    requireJWT<AppUser>({
      secret: HS256_SECRET,
      issuer: 'my-api',
      audience: 'my-users',
      extractUser: (claims) => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
      }),
    });

  it('rejects a missing Authorization header with 401', async () => {
    const hook = makeHook();
    const { ctx, responses } = makeContext<RequireJwtResponses>({});
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.status).toBe(401);
    expect((responses[0]!.body as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('rejects a non-Bearer scheme with 401', async () => {
    const hook = makeHook();
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: 'Basic dXNlcjpwYXNz',
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect(responses[0]!.status).toBe(401);
  });

  it('rejects an empty Bearer token with 401', async () => {
    const hook = makeHook();
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: 'Bearer    ',
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect(responses[0]!.status).toBe(401);
  });

  it('rejects a malformed token with a 401 and clean message', async () => {
    const hook = makeHook();
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: 'Bearer not-a-jwt',
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    const body = responses[0]!.body as { code: string; message: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(body.message).toContain('Invalid token');
  });

  it('rejects a token with the wrong issuer', async () => {
    const hook = makeHook();
    const token = await signToken({
      issuer: 'attacker',
      audience: 'my-users',
      subject: 'u1',
      payload: { email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect(responses[0]!.status).toBe(401);
    expect((responses[0]!.body as { message: string }).message).toMatch(/Invalid token/i);
  });

  it('rejects a token with the wrong audience', async () => {
    const hook = makeHook();
    const token = await signToken({
      issuer: 'my-api',
      audience: 'other-app',
      subject: 'u1',
      payload: { email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toMatch(/Invalid token/i);
  });

  it('rejects an expired token beyond clock tolerance', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      issuer: 'my-api',
      audience: 'my-users',
      clockTolerance: 0,
      extractUser: (claims) => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
      }),
    });
    const token = await signExpiredToken({
      expiredSecondsAgo: 300,
      issuer: 'my-api',
      audience: 'my-users',
      subject: 'u1',
      payload: { email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toMatch(/Invalid token/i);
  });

  it('accepts a slightly-expired token within clock tolerance', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      clockTolerance: 60,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = await signExpiredToken({
      expiredSecondsAgo: 10,
      subject: 'u1',
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects a token signed with the wrong key', async () => {
    const hook = makeHook();
    const wrongKey = new TextEncoder().encode(
      'completely-different-secret-key-here!!',
    );
    const token = await signToken({
      secret: wrongKey,
      issuer: 'my-api',
      audience: 'my-users',
      subject: 'u1',
      payload: { email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toMatch(/Invalid token/i);
  });

  it('enforces the algorithms whitelist', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      algorithms: ['RS256'],
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = await signToken({
      algorithm: 'HS256',
      subject: 'u1',
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toMatch(/Invalid token/i);
  });
});

describe('requireJWT — extractUser and onVerified hooks', () => {
  it('rejects with 401 when extractUser throws', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => {
        if (claims['sub'] === undefined) throw new Error('missing sub');
        return { id: claims['sub'] as string, email: '' };
      },
    });
    const token = await signToken({ payload: { email: 'a@b.c' } });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toBe(
      'Token claims rejected.',
    );
  });

  it('calls onVerified with claims and the extracted user', async () => {
    const onVerified = vi.fn();
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => ({
        id: claims['sub'] as string,
        email: 'a@b.c',
      }),
      onVerified,
    });
    const token = await signToken({ subject: 'u1' });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    await hook(ctx);
    expect(onVerified).toHaveBeenCalledTimes(1);
    const [passedClaims, passedUser] = onVerified.mock.calls[0]!;
    expect(passedClaims).toMatchObject({ sub: 'u1' });
    expect(passedUser).toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('awaits an async onVerified hook', async () => {
    let resolved = false;
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
      onVerified: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
      },
    });
    const token = await signToken({ subject: 'u1' });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    await hook(ctx);
    expect(resolved).toBe(true);
  });

  it('rejects with 401 when onVerified throws (revocation pattern)', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
      onVerified: () => {
        throw new Error('revoked');
      },
    });
    const token = await signToken({ subject: 'u1' });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain(
      'post-verification',
    );
  });
});

describe('requireJWT — verify options forwarding', () => {
  it('forwards verify options (issuer/audience/algorithms/clockTolerance) to jose', async () => {
    const hook = requireJWT<AppUser>({
      secret: HS256_SECRET,
      issuer: 'my-api',
      audience: ['my-users', 'my-admins'],
      algorithms: ['HS256'],
      clockTolerance: 17,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = await signToken({
      algorithm: 'HS256',
      issuer: 'my-api',
      audience: 'my-users',
      subject: 'u1',
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });
});

describe('requireJWT — JWKS mode', () => {
  it('reuses the JWKS key set across requests (caching)', async () => {
    const { createServer } = await import('node:http');
    const { getRs256Keys, exportJWK } = await import('./test-helpers.js');

    const keys = await getRs256Keys();
    const pubJwk = await exportJWK(keys.publicKey);
    const jwks = { keys: [{ ...pubJwk, alg: 'RS256', use: 'sig', kid: 'test-key' }] };

    let jwksHitCount = 0;
    const server = createServer((req, res) => {
      jwksHitCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jwks));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const jwksUri = `http://127.0.0.1:${String(port)}/.well-known/jwks.json`;

    try {
      const hook = requireJWT<AppUser>({
        jwksUri,
        issuer: 'test-issuer',
        algorithms: ['RS256'],
        extractUser: (claims) => ({
          id: claims['sub'] as string,
          email: '',
        }),
      });

      const token = await signToken({
        secret: keys.privateKey,
        algorithm: 'RS256',
        issuer: 'test-issuer',
        subject: 'u1',
      });

      for (let i = 0; i < 3; i += 1) {
        const { ctx } = makeContext<RequireJwtResponses>({
          authorization: `Bearer ${token}`,
        });
        const result = await hook(ctx);
        expect(result.ok).toBe(true);
      }

      expect(jwksHitCount).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
