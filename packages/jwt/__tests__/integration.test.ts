/**
 * Integration tests: `requireJWT` composed with a realistic
 * `BeforeHandlerContext` and generic `TUser` type inference through
 * to `ctx.state.user`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BeforeHandlerResult } from '@triad/core';
import { requireJWT } from '../src/require-jwt.js';
import type { RequireJwtResponses } from '../src/types.js';
import { __setJoseForTesting } from '../src/jose-adapter.js';
import { encodeFakeToken, fakeJose, makeContext } from './test-helpers.js';

const SECRET = 'integration-secret';

interface DomainUser {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
}

beforeEach(() => {
  __setJoseForTesting(fakeJose());
});

afterEach(() => {
  __setJoseForTesting(undefined);
});

describe('requireJWT — integration', () => {
  it('threads the inferred TUser type through to state.user', async () => {
    const hook = requireJWT({
      secret: SECRET,
      extractUser: (claims): DomainUser => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
        roles: (claims['roles'] as string[] | undefined) ?? [],
      }),
    });
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: { sub: 'u1', email: 'a@b.c', roles: ['admin'] },
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result: BeforeHandlerResult<{ user: DomainUser }> = await hook(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const user: DomainUser = result.state.user;
      expect(user.id).toBe('u1');
      expect(user.roles).toEqual(['admin']);
    }
  });

  it('composes two protected calls that share a JWKS set', async () => {
    const jwksCreateLog: URL[] = [];
    __setJoseForTesting(fakeJose({ jwksCreateLog }));
    const hook = requireJWT({
      jwksUri: 'https://tenant.example.com/.well-known/jwks.json',
      issuer: 'https://tenant.example.com',
      audience: 'api',
      extractUser: (claims): { id: string } => ({ id: claims['sub'] as string }),
    });
    const token = encodeFakeToken({
      keyId: 'JWKS',
      claims: { iss: 'https://tenant.example.com', aud: 'api', sub: 'u1' },
    });
    for (let i = 0; i < 3; i += 1) {
      const { ctx } = makeContext<RequireJwtResponses>({
        authorization: `Bearer ${token}`,
      });
      const result = await hook(ctx);
      expect(result.ok).toBe(true);
    }
    expect(jwksCreateLog).toHaveLength(1);
  });

  it('short-circuits with a response that carries the endpoint status', async () => {
    const hook = requireJWT({
      secret: SECRET,
      extractUser: (claims): { id: string } => ({ id: claims['sub'] as string }),
    });
    const { ctx } = makeContext<RequireJwtResponses>({});
    const result = await hook(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('distinguishes multiple audiences', async () => {
    const hook = requireJWT({
      secret: SECRET,
      audience: ['api-v1', 'api-v2'],
      extractUser: (claims): { id: string } => ({ id: claims['sub'] as string }),
    });
    const token = encodeFakeToken({
      keyId: SECRET,
      claims: { aud: 'api-v2', sub: 'u1' },
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });
});
