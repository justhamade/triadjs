/**
 * In-memory bearer token store.
 *
 * Tokens are intentionally NOT stored in Drizzle. A bearer token is a
 * short-lived credential that a reference example has no good reason
 * to persist across server restarts — losing all tokens on restart is
 * a feature, not a bug, in a demo. Keeping them in a plain `Map` also
 * demonstrates that Triad services are heterogeneous by design (the
 * petstore example uses the same pattern for its `MessageStore`).
 *
 * Real production systems would:
 *   - Use signed JWTs so no server-side storage is required, or
 *   - Use Redis / Drizzle with an expiry column, or
 *   - Use an OIDC provider and validate bearer tokens by signature.
 *
 * We do none of the above. `issue()` returns a random UUID, `lookup()`
 * reads from the map, `revoke()` deletes. Login rotates the token —
 * each successful login issues a brand-new token so a stolen token
 * can be invalidated by re-logging-in.
 */

export class TokenStore {
  private readonly tokens = new Map<string, string>();

  /**
   * Issue a fresh token for `userId`. Any previously-issued tokens for
   * the same user remain valid until explicitly revoked — this matches
   * how most web apps behave (login from a second device does not
   * invalidate the first device).
   */
  issue(userId: string): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, userId);
    return token;
  }

  /** Resolve a bearer token to a user id. Returns `null` if unknown. */
  lookup(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /**
   * Wipe every token. Called by `test-setup.ts` between scenarios so
   * tokens issued by one test can never be seen by another. Without
   * this, the in-memory map would leak across the per-scenario DB
   * boundary.
   */
  async clear(): Promise<void> {
    this.tokens.clear();
  }
}
