/**
 * Structural interface for the subset of the `jose` package that
 * `@triad/jwt` uses. Kept behind a narrow port so we can mock it in
 * tests and so a breaking change to `jose` is visible in one place.
 */
export interface JoseVerifyOptions {
  issuer?: string | string[];
  audience?: string | string[];
  algorithms?: string[];
  clockTolerance?: number;
}

export interface JoseVerifyResult {
  payload: Record<string, unknown>;
}

export type JoseVerifyKey = unknown;

export interface JoseLike {
  jwtVerify(
    token: string,
    key: JoseVerifyKey | ((...args: unknown[]) => unknown),
    options?: JoseVerifyOptions,
  ): Promise<JoseVerifyResult>;
  createRemoteJWKSet(url: URL): JoseVerifyKey;
}

/**
 * Cached jose module handle. We deliberately avoid a top-level
 * `import('jose')` so that `@triad/jwt` can be imported even if the
 * user has not installed the peer dep — the error only surfaces when
 * the factory tries to verify its first token.
 */
let cached: JoseLike | undefined;

/** For testing: inject a fake jose implementation. */
export function __setJoseForTesting(mock: JoseLike | undefined): void {
  cached = mock;
}

export async function loadJose(): Promise<JoseLike> {
  if (cached) return cached;
  try {
    // Intentional dynamic import — see module docblock. `jose` is
    // an optional peer dep so TypeScript may not resolve its types
    // when the consumer has not installed it yet.
    // @ts-expect-error — optional peer dependency
    const mod = (await import('jose')) as unknown as JoseLike;
    if (typeof mod.jwtVerify !== 'function') {
      throw new Error('jose module does not export jwtVerify');
    }
    cached = mod;
    return mod;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `@triad/jwt requires the \`jose\` package as a peer dependency. Install it with \`npm install jose\`. Underlying error: ${reason}`,
    );
  }
}
