/**
 * Test helpers for `@triad/jwt`.
 *
 * These factories build the minimum viable objects to exercise a
 * `BeforeHandler` without dragging in the full router pipeline:
 *
 *   - `fakeJose()` — a structural mock of the jose module that does
 *     no real cryptography. Tokens are JSON-encoded claim bags with
 *     a `__sig__` marker the mock checks for equality against the
 *     key. This is enough to cover option-passing, error paths, and
 *     key resolution without linking to the real `jose` package.
 *
 *   - `makeContext()` — produces a `BeforeHandlerContext`-shaped
 *     object with a `respond[401]` that records its argument so
 *     tests can assert on the response body.
 */

import type { BeforeHandlerContext, ResponsesConfig, HandlerResponse } from '@triad/core';
import type {
  JoseLike,
  JoseVerifyKey,
  JoseVerifyOptions,
  JoseVerifyResult,
} from '../src/jose-adapter.js';

export interface FakeToken {
  readonly claims: Record<string, unknown>;
  readonly alg?: string;
  readonly keyId?: string;
}

/**
 * Encode a fake token. Production `jose` would produce a real
 * base64-encoded signed JWT; here we just serialize the bag with a
 * sigil the fake verifier can parse.
 */
export function encodeFakeToken(tok: FakeToken): string {
  return `fake.${Buffer.from(JSON.stringify(tok), 'utf8').toString('base64url')}`;
}

export interface FakeJoseOptions {
  /**
   * Predicate invoked with the resolved key and the token's recorded
   * key id. Defaults to strict equality on the serialized key.
   */
  keyMatches?: (key: JoseVerifyKey, tokenKeyId: string | undefined) => boolean;
  /**
   * Override "now" for expiry tests. Seconds since epoch.
   */
  now?: () => number;
  /**
   * Spy — incremented on each `jwtVerify` call. Exposed to let tests
   * assert on caching behaviour.
   */
  verifyCallLog?: Array<{ token: string; options: JoseVerifyOptions | undefined }>;
  /**
   * Spy — incremented on each `createRemoteJWKSet` call.
   */
  jwksCreateLog?: URL[];
}

function keysEqual(a: JoseVerifyKey, b: JoseVerifyKey): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

/**
 * Build a fake `jose`-like module. It implements just enough behaviour
 * to exercise `requireJWT`:
 *   - Parses the opaque `fake.<base64>` token produced by
 *     `encodeFakeToken`.
 *   - Checks `issuer` / `audience` / `algorithms` / `clockTolerance`
 *     if supplied.
 *   - Rejects tokens whose recorded `keyId` doesn't match the resolved
 *     key (via `keyMatches`).
 */
export function fakeJose(opts: FakeJoseOptions = {}): JoseLike {
  const now = opts.now ?? ((): number => Math.floor(Date.now() / 1000));
  const verifyLog = opts.verifyCallLog;
  const jwksLog = opts.jwksCreateLog;
  const keyMatches =
    opts.keyMatches ??
    ((key: JoseVerifyKey, tokenKeyId: string | undefined): boolean => {
      if (key instanceof Uint8Array) {
        const decoded = new TextDecoder().decode(key);
        return decoded === tokenKeyId;
      }
      // JWKS "remote set" marker — we treat any JWKS-ish key as matching
      // tokens that recorded their keyId as "JWKS".
      if (typeof key === 'object' && key !== null && '__jwks__' in key) {
        return tokenKeyId === 'JWKS';
      }
      return false;
    });

  return {
    async jwtVerify(
      token: string,
      key: JoseVerifyKey,
      options?: JoseVerifyOptions,
    ): Promise<JoseVerifyResult> {
      verifyLog?.push({ token, options });
      if (!token.startsWith('fake.')) {
        throw new Error('malformed token');
      }
      const raw = Buffer.from(token.slice(5), 'base64url').toString('utf8');
      let parsed: FakeToken;
      try {
        parsed = JSON.parse(raw) as FakeToken;
      } catch {
        throw new Error('malformed token');
      }
      if (!keyMatches(key, parsed.keyId)) {
        throw new Error('signature verification failed');
      }
      if (options?.algorithms && parsed.alg !== undefined) {
        if (!options.algorithms.includes(parsed.alg)) {
          throw new Error(`alg ${parsed.alg} not allowed`);
        }
      }
      const claims = parsed.claims;
      if (options?.issuer !== undefined) {
        const allowed = Array.isArray(options.issuer) ? options.issuer : [options.issuer];
        const iss = claims['iss'];
        if (typeof iss !== 'string' || !allowed.includes(iss)) {
          throw new Error('issuer mismatch');
        }
      }
      if (options?.audience !== undefined) {
        const allowed = Array.isArray(options.audience) ? options.audience : [options.audience];
        const aud = claims['aud'];
        const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
        if (!audList.some((a) => allowed.includes(a))) {
          throw new Error('audience mismatch');
        }
      }
      const exp = claims['exp'];
      if (typeof exp === 'number') {
        const tolerance = options?.clockTolerance ?? 0;
        if (now() > exp + tolerance) {
          throw new Error('"exp" claim timestamp check failed');
        }
      }
      return { payload: claims };
    },
    createRemoteJWKSet(url: URL): JoseVerifyKey {
      jwksLog?.push(url);
      return { __jwks__: true, url: url.href };
    },
  };
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
