/**
 * In-memory bearer token store.
 *
 * Tokens are intentionally NOT persisted. A bearer token in a reference
 * example has no good reason to survive server restarts — losing every
 * token on restart is a feature in a demo, not a bug. Keeping them in
 * a plain `Map` also demonstrates that Triad services are heterogeneous
 * by design: the `UserRepository` is Drizzle-backed, `TokenStore` is a
 * `Map`, and handlers treat both the same way through `ctx.services`.
 *
 * Production alternatives:
 *   - Signed JWTs — no server-side storage at all
 *   - Redis with TTLs — cheap revocation plus auto-expiry
 *   - An OIDC provider — validate bearer tokens by signature
 *
 * None of the above are implemented here. `issue()` returns a random
 * UUID, `lookup()` reads from the map, `revoke()` deletes.
 */

export class TokenStore {
  private readonly tokens = new Map<string, string>();

  /** Issue a fresh token for a user. Previously-issued tokens stay valid. */
  issue(userId: string): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, userId);
    return token;
  }

  /** Resolve a bearer token to a user id, or `null` if unknown. */
  lookup(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /**
   * Wipe every token. Called by `test-setup.ts` between scenarios so
   * tokens issued by one scenario can never leak into another — the
   * in-memory `Map` lives outside the per-scenario SQLite database,
   * so closing the DB is not enough on its own.
   */
  async clear(): Promise<void> {
    this.tokens.clear();
  }
}
