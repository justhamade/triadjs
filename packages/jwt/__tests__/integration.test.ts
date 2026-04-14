/**
 * Integration tests: `requireJWT` composed with a realistic
 * `BeforeHandlerContext` and generic `TUser` type inference through
 * to `ctx.state.user`.
 */

import { describe, expect, it } from 'vitest';
import type { BeforeHandlerResult } from '@triadjs/core';
import { requireJWT } from '../src/require-jwt.js';
import type { RequireJwtResponses } from '../src/types.js';
import {
  HS256_SECRET,
  signToken,
  makeContext,
  getRs256Keys,
  exportJWK,
} from './test-helpers.js';

interface DomainUser {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
}

describe('requireJWT — integration', () => {
  it('threads the inferred TUser type through to state.user', async () => {
    const hook = requireJWT({
      secret: HS256_SECRET,
      extractUser: (claims): DomainUser => ({
        id: claims['sub'] as string,
        email: claims['email'] as string,
        roles: (claims['roles'] as string[] | undefined) ?? [],
      }),
    });
    const token = await signToken({
      subject: 'u1',
      payload: { email: 'a@b.c', roles: ['admin'] },
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
    const { createServer } = await import('node:http');

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
      const hook = requireJWT({
        jwksUri,
        issuer: 'https://tenant.example.com',
        algorithms: ['RS256'],
        extractUser: (claims): { id: string } => ({
          id: claims['sub'] as string,
        }),
      });

      const token = await signToken({
        secret: keys.privateKey,
        algorithm: 'RS256',
        issuer: 'https://tenant.example.com',
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

  it('short-circuits with a response that carries the endpoint status', async () => {
    const hook = requireJWT({
      secret: HS256_SECRET,
      extractUser: (claims): { id: string } => ({
        id: claims['sub'] as string,
      }),
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
      secret: HS256_SECRET,
      audience: ['api-v1', 'api-v2'],
      extractUser: (claims): { id: string } => ({
        id: claims['sub'] as string,
      }),
    });
    const token = await signToken({
      audience: 'api-v2',
      subject: 'u1',
    });
    const { ctx } = makeContext<RequireJwtResponses>({
      authorization: `Bearer ${token}`,
    });
    const result = await hook(ctx);
    expect(result.ok).toBe(true);
  });
});
