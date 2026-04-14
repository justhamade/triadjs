/**
 * Type definitions for @triadjs/jwt.
 *
 * These types are pure declarations — no runtime code lives here, so
 * importing this module never triggers a `jose` lookup.
 */

import type { ResponseConfig } from '@triadjs/core';

/**
 * Standard JWT claims (RFC 7519). Concrete apps extend this via the
 * index signature and decide in `extractUser` which custom claims to
 * lift onto their domain `User` type.
 */
export interface StandardJwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [customClaim: string]: unknown;
}

/**
 * Options for `requireJWT`.
 *
 * Exactly one of `jwksUri` or `secret` must be supplied. Supplying
 * both (or neither) is rejected at factory-build time.
 */
export interface RequireJwtOptions<TUser> {
  /**
   * JWKS URI for fetching rotating public keys. Preferred in production
   * with RS256 / ES256 tokens issued by a third-party auth provider.
   */
  jwksUri?: string;
  /**
   * Shared secret for HS* algorithms. Supplied as a string (UTF-8
   * encoded internally) or a pre-encoded `Uint8Array`.
   */
  secret?: string | Uint8Array;
  /**
   * Expected `iss`. Tokens with a different issuer are rejected by
   * `jose.jwtVerify`.
   */
  issuer?: string | string[];
  /**
   * Expected `aud`. Rejecting mismatched audiences is the single
   * most important check to prevent token confusion attacks — do
   * not skip it.
   */
  audience?: string | string[];
  /**
   * Clock skew tolerance in seconds applied to `exp` and `nbf`.
   * Defaults to 5 seconds. Do not push past 60 without reason.
   */
  clockTolerance?: number;
  /**
   * Allowed signature algorithms. Defaults to
   * `['RS256', 'ES256', 'HS256']`. Restrict to the algorithm your
   * issuer uses — leaving HS256 alongside RS256 enables the classic
   * "algorithm confusion" attack if your key material is ever
   * mishandled.
   */
  algorithms?: string[];
  /**
   * Map verified claims onto your app's domain user type. Triad
   * does not guess at your user shape — you decide what `id`,
   * `email`, `roles`, or `tenantId` look like.
   *
   * Throwing from `extractUser` produces a 401. Use this to reject
   * tokens whose claims are structurally valid but semantically
   * unacceptable (e.g. missing `sub`).
   */
  extractUser: (claims: StandardJwtClaims) => TUser;
  /**
   * Optional async hook called after a token verifies and
   * `extractUser` succeeds. Use for audit logging, revocation
   * checks, or last-seen updates. Throwing from this hook rejects
   * the request with a 401.
   */
  onVerified?: (claims: StandardJwtClaims, user: TUser) => void | Promise<void>;
}

/**
 * Error response schema slot that every endpoint protected by
 * `requireJWT` MUST declare in its `responses` config.
 *
 * The type is a `Record<number, ResponseConfig>` so it satisfies
 * `@triadjs/core`'s `ResponsesConfig` constraint, with the 401 slot
 * made required via intersection. This lets `requireJWT`'s
 * `BeforeHandler<_, RequireJwtResponses>` compose cleanly with any
 * endpoint whose `responses` map includes a 401.
 */
export type RequireJwtResponses = Record<number, ResponseConfig> & {
  401: ResponseConfig;
};
