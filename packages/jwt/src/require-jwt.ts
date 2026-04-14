/**
 * `requireJWT` — a factory that produces a Triad `BeforeHandler` which
 * validates a Bearer JWT on every request.
 *
 * The returned hook:
 *   1. Reads `Authorization: Bearer <token>` from `ctx.rawHeaders`.
 *   2. Verifies the token via `jose.jwtVerify` using the configured
 *      key material (JWKS or shared secret).
 *   3. Calls `options.extractUser` to derive your domain user type.
 *   4. Optionally calls `options.onVerified` for audit / revocation.
 *   5. Either returns `{ ok: true, state: { user } }` or short-circuits
 *      with a typed 401 via `ctx.respond[401]`.
 *
 * Every failure mode produces a 401 — this hook deliberately does not
 * distinguish "no header" from "bad signature" at the wire, which is
 * the correct behaviour for an unauthenticated endpoint.
 */

import type { BeforeHandler } from '@triadjs/core';
import type { RequireJwtOptions, RequireJwtResponses, StandardJwtClaims } from './types.js';
import { loadJose, type JoseLike, type JoseVerifyKey, type JoseVerifyOptions } from './jose-adapter.js';

type KeyResolver = (jose: JoseLike) => JoseVerifyKey;

interface UnauthenticatedError {
  readonly code: 'UNAUTHENTICATED';
  readonly message: string;
}

function parseBearer(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== 'string') return null;
  if (!headerValue.startsWith('Bearer ')) return null;
  const token = headerValue.slice(7).trim();
  return token.length > 0 ? token : null;
}

function buildKeyResolver<TUser>(options: RequireJwtOptions<TUser>): KeyResolver {
  const hasJwks = options.jwksUri !== undefined;
  const hasSecret = options.secret !== undefined;

  if (hasJwks && hasSecret) {
    throw new Error(
      '@triadjs/jwt: requireJWT accepts exactly one of `jwksUri` or `secret`, not both.',
    );
  }
  if (!hasJwks && !hasSecret) {
    throw new Error(
      '@triadjs/jwt: requireJWT requires either `jwksUri` or `secret`.',
    );
  }

  if (hasJwks) {
    const uri = options.jwksUri as string;
    let cached: JoseVerifyKey | undefined;
    return (jose) => {
      if (cached !== undefined) return cached;
      cached = jose.createRemoteJWKSet(new URL(uri));
      return cached;
    };
  }

  const raw = options.secret as string | Uint8Array;
  const key: Uint8Array = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  return () => key;
}

function buildVerifyOptions<TUser>(options: RequireJwtOptions<TUser>): JoseVerifyOptions {
  const out: JoseVerifyOptions = {};
  if (options.issuer !== undefined) out.issuer = options.issuer;
  if (options.audience !== undefined) out.audience = options.audience;
  if (options.algorithms !== undefined) out.algorithms = options.algorithms;
  out.clockTolerance = options.clockTolerance ?? 5;
  return out;
}

/**
 * Build a `BeforeHandler` that verifies a Bearer JWT and attaches a
 * user object to `ctx.state.user`.
 *
 * The generic `TUser` is inferred from `options.extractUser`'s return
 * type, so downstream handlers see `ctx.state.user` fully typed with
 * zero annotations.
 */
export function requireJWT<TUser>(
  options: RequireJwtOptions<TUser>,
): BeforeHandler<{ user: TUser }, RequireJwtResponses> {
  const resolveKey = buildKeyResolver(options);
  const verifyOptions = buildVerifyOptions(options);

  return async (ctx) => {
    const header = ctx.rawHeaders['authorization'] ?? ctx.rawHeaders['Authorization'];
    const token = parseBearer(header);
    if (token === null) {
      const err: UnauthenticatedError = {
        code: 'UNAUTHENTICATED',
        message: 'Missing or malformed Authorization header. Expected "Bearer <token>".',
      };
      return { ok: false, response: ctx.respond[401]!(err) };
    }

    let claims: StandardJwtClaims;
    try {
      const jose = await loadJose();
      const key = resolveKey(jose);
      const result = await jose.jwtVerify(token, key, verifyOptions);
      claims = result.payload as StandardJwtClaims;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid token';
      const payload: UnauthenticatedError = {
        code: 'UNAUTHENTICATED',
        message: `Invalid token: ${message}`,
      };
      return { ok: false, response: ctx.respond[401]!(payload) };
    }

    let user: TUser;
    try {
      user = options.extractUser(claims);
    } catch {
      const payload: UnauthenticatedError = {
        code: 'UNAUTHENTICATED',
        message: 'Token claims rejected.',
      };
      return { ok: false, response: ctx.respond[401]!(payload) };
    }

    if (options.onVerified) {
      try {
        await options.onVerified(claims, user);
      } catch {
        const payload: UnauthenticatedError = {
          code: 'UNAUTHENTICATED',
          message: 'Token rejected after post-verification check.',
        };
        return { ok: false, response: ctx.respond[401]!(payload) };
      }
    }

    return { ok: true, state: { user } };
  };
}
