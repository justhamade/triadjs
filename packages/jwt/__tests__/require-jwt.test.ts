/**
 * Behavioural tests for `requireJWT`.
 *
 * These tests drive every public surface through the factory — no
 * internals are reached into beyond `__setJoseForTesting` which is
 * the package's documented test seam for the jose peer dep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireJWT } from '../src/require-jwt.js';
import type { RequireJwtResponses } from '../src/types.js';
import { __setJoseForTesting } from '../src/jose-adapter.js';
import { encodeFakeToken, fakeJose, makeContext } from './test-helpers.js';
import type { JoseVerifyOptions } from '../src/jose-adapter.js';

const SECRET = 'super-secret-key';

interface AppUser {
  id: string;
  email: string;
}

beforeEach(() => {
  __setJoseForTesting(fakeJose());
});

afterEach(() => {
  __setJoseForTesting(undefined);
});

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
      secret: SECRET,
      issuer: 'my-api',
      audience: 'my-users',
      algorithms: ['HS256'],
      extractUser: (claims) => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
      }),
    });
    const token = encodeFakeToken({
      alg: 'HS256',
      keyId: SECRET,
      claims: {
        iss: 'my-api',
        aud: 'my-users',
        sub: 'user-42',
        email: 'alice@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    const { ctx } = makeContext<RequireJwtResponses>({ authorization: `Bearer ${token}` });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toEqual({
        user: { id: 'user-42', email: 'alice@example.com' },
      });
    }
  });

  it('accepts Uint8Array secrets for HS256', async () => {
    const keyBytes = new TextEncoder().encode(SECRET);
    const hook = requireJWT<AppUser>({
      secret: keyBytes,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({
      alg: 'HS256',
      keyId: SECRET,
      claims: { sub: 'u1' },
    });
    const { ctx } = makeContext<RequireJwtResponses>({ authorization: `Bearer ${token}` });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });

  it('accepts lowercase and capitalized Authorization headers', async () => {
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({ keyId: SECRET, claims: { sub: 'u1' } });
    const { ctx } = makeContext<RequireJwtResponses>({ Authorization: `Bearer ${token}` });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });
});

describe('requireJWT — authentication failures', () => {
  const makeHook = (): ReturnType<typeof requireJWT<AppUser>> =>
    requireJWT<AppUser>({
      secret: SECRET,
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
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: { iss: 'attacker', aud: 'my-users', sub: 'u1', email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect(responses[0]!.status).toBe(401);
    expect((responses[0]!.body as { message: string }).message).toContain('issuer');
  });

  it('rejects a token with the wrong audience', async () => {
    const hook = makeHook();
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: { iss: 'my-api', aud: 'other-app', sub: 'u1', email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain('audience');
  });

  it('rejects an expired token beyond clock tolerance', async () => {
    const hook = makeHook();
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: {
        iss: 'my-api',
        aud: 'my-users',
        sub: 'u1',
        email: 'a@b.c',
        exp: Math.floor(Date.now() / 1000) - 300,
      },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain('exp');
  });

  it('accepts a slightly-expired token within clock tolerance', async () => {
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      clockTolerance: 60,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: {
        sub: 'u1',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects a token signed with the wrong key', async () => {
    const hook = makeHook();
    const token = encodeFakeToken({
      keyId: 'different-secret',
      claims: { iss: 'my-api', aud: 'my-users', sub: 'u1', email: 'a@b.c' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain('signature');
  });

  it('enforces the algorithms whitelist', async () => {
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      algorithms: ['RS256'],
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({
      alg: 'HS256',
      keyId: SECRET,
      claims: { sub: 'u1' },
    });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain('HS256');
  });
});

describe('requireJWT — extractUser and onVerified hooks', () => {
  it('rejects with 401 when extractUser throws', async () => {
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      extractUser: (claims) => {
        if (claims['sub'] === undefined) throw new Error('missing sub');
        return { id: claims['sub'] as string, email: '' };
      },
    });
    const token = encodeFakeToken({ keyId: SECRET, claims: { email: 'a@b.c' } });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toBe('Token claims rejected.');
  });

  it('calls onVerified with claims and the extracted user', async () => {
    const onVerified = vi.fn();
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: 'a@b.c' }),
      onVerified,
    });
    const token = encodeFakeToken({ keyId: SECRET, claims: { sub: 'u1' } });
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
      secret: SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
      onVerified: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
      },
    });
    const token = encodeFakeToken({ keyId: SECRET, claims: { sub: 'u1' } });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    await hook(ctx);
    expect(resolved).toBe(true);
  });

  it('rejects with 401 when onVerified throws (revocation pattern)', async () => {
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
      onVerified: () => {
        throw new Error('revoked');
      },
    });
    const token = encodeFakeToken({ keyId: SECRET, claims: { sub: 'u1' } });
    const { ctx, responses } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    expect((responses[0]!.body as { message: string }).message).toContain('post-verification');
  });
});

describe('requireJWT — JWKS caching', () => {
  it('reuses the JWKS key set across requests', async () => {
    const jwksCreateLog: URL[] = [];
    __setJoseForTesting(fakeJose({ jwksCreateLog }));
    const hook = requireJWT<AppUser>({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({ keyId: 'JWKS', claims: { sub: 'u1' } });
    const { ctx: ctx1 } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const { ctx: ctx2 } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    await hook(ctx1);
    await hook(ctx2);
    expect(jwksCreateLog).toHaveLength(1);
  });

  it('forwards verify options (issuer/audience/algorithms/clockTolerance) to jose', async () => {
    const verifyCallLog: Array<{ token: string; options: JoseVerifyOptions | undefined }> = [];
    __setJoseForTesting(fakeJose({ verifyCallLog }));
    const hook = requireJWT<AppUser>({
      secret: SECRET,
      issuer: 'my-api',
      audience: ['my-users', 'my-admins'],
      algorithms: ['HS256'],
      clockTolerance: 17,
      extractUser: (claims) => ({ id: claims['sub'] as string, email: '' }),
    });
    const token = encodeFakeToken({
      alg: 'HS256',
      keyId: SECRET,
      claims: { iss: 'my-api', aud: 'my-users', sub: 'u1' },
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    await hook(ctx);
    expect(verifyCallLog).toHaveLength(1);
    expect(verifyCallLog[0]!.options).toEqual({
      issuer: 'my-api',
      audience: ['my-users', 'my-admins'],
      algorithms: ['HS256'],
      clockTolerance: 17,
    });
  });
});
