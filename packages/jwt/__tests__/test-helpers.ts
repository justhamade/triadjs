/**
 * Test helpers for `@triad/jwt`.
 *
 * These utilities use the real `jose` library for token signing so
 * tests exercise genuine cryptographic verification — no fakes.
 *
 *   - `signToken()` / `signExpiredToken()` — produce real JWTs.
 *   - `HS256_SECRET` — shared symmetric key for HS256 tests.
 *   - `makeContext()` — builds a `BeforeHandlerContext`-shaped object
 *     with a `respond[401]` that records its argument so tests can
 *     assert on the response body.
 */

import { SignJWT, generateKeyPair, exportJWK, type CryptoKey as JoseCryptoKey } from 'jose';
import type { BeforeHandlerContext, ResponsesConfig, HandlerResponse } from '@triad/core';

export const HS256_SECRET = new TextEncoder().encode(
  'test-secret-at-least-32-bytes-long!!!',
);

let _rs256Keys: { publicKey: JoseCryptoKey; privateKey: JoseCryptoKey } | undefined;

export async function getRs256Keys(): Promise<{
  publicKey: JoseCryptoKey;
  privateKey: JoseCryptoKey;
}> {
  if (!_rs256Keys) _rs256Keys = await generateKeyPair('RS256');
  return _rs256Keys;
}

export { exportJWK };

export async function signToken(options: {
  payload?: Record<string, unknown>;
  secret?: Uint8Array | JoseCryptoKey;
  algorithm?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  subject?: string;
}): Promise<string> {
  const {
    payload = {},
    secret = HS256_SECRET,
    algorithm = 'HS256',
    issuer,
    audience,
    expiresIn = '1h',
    subject,
  } = options;

  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt()
    .setExpirationTime(expiresIn);

  if (issuer) builder = builder.setIssuer(issuer);
  if (audience) builder = builder.setAudience(audience);
  if (subject) builder = builder.setSubject(subject);

  return builder.sign(secret);
}

export async function signExpiredToken(
  options: Omit<Parameters<typeof signToken>[0], 'expiresIn'> & {
    expiredSecondsAgo?: number;
  } = {},
): Promise<string> {
  const { expiredSecondsAgo = 60, payload = {}, ...rest } = options;
  const now = Math.floor(Date.now() / 1000);
  const exp = now - expiredSecondsAgo;
  const iat = exp - 60;

  const {
    secret = HS256_SECRET,
    algorithm = 'HS256',
    issuer,
    audience,
    subject,
  } = rest;

  let builder = new SignJWT({ ...payload, exp, iat }).setProtectedHeader({
    alg: algorithm,
  });

  if (issuer) builder = builder.setIssuer(issuer);
  if (audience) builder = builder.setAudience(audience);
  if (subject) builder = builder.setSubject(subject);

  return builder.sign(secret);
}

// ---------------------------------------------------------------------------
// Fake BeforeHandlerContext
// ---------------------------------------------------------------------------

export interface RecordedResponse {
  status: number;
  body: unknown;
}

export interface FakeContextResult<TResponses extends ResponsesConfig> {
  ctx: BeforeHandlerContext<TResponses>;
  responses: RecordedResponse[];
}

export function makeContext<TResponses extends ResponsesConfig>(
  headers: Record<string, string | string[] | undefined> = {},
): FakeContextResult<TResponses> {
  const responses: RecordedResponse[] = [];
  const respond = new Proxy(
    {},
    {
      get: (_target, prop) => {
        const status = Number(prop);
        return (body: unknown): HandlerResponse => {
          const response = { status, body };
          responses.push(response);
          return response;
        };
      },
    },
  ) as BeforeHandlerContext<TResponses>['respond'];

  const ctx: BeforeHandlerContext<TResponses> = {
    rawHeaders: headers,
    rawQuery: {},
    rawParams: {},
    rawCookies: {},
    services: {} as BeforeHandlerContext<TResponses>['services'],
    respond,
  };
  return { ctx, responses };
}
