/**
 * Per-scenario test setup.
 *
 * The Triad test runner imports this module's default export as a
 * services factory and calls it before every scenario. The returned
 * object exposes `cleanup()` which the runner invokes afterwards
 * (configured via `test.teardown: 'cleanup'` in `triad.config.ts`).
 *
 * Every scenario gets a FRESH set of in-memory repositories and a
 * fresh `MemoryAuthVerifier`. This makes tests self-contained: no
 * seeded data from a previous scenario ever leaks into the next one,
 * and no setup ordering assumptions accumulate.
 *
 * ## No real Supabase in tests
 *
 * This file deliberately calls `createServices({ mode: 'memory' })`.
 * The Supabase-backed repositories and auth verifier ship in this
 * example (see `src/repositories/*-supabase.ts` and
 * `src/auth-verifier-supabase.ts`) but are never exercised by the
 * test runner — CI can't reach a Supabase project, and even if it
 * could, network-dependent behavior tests are orders of magnitude
 * slower than in-process ones.
 *
 * The pattern is:
 *
 *   - Write scenarios against the memory backend.
 *   - Trust the `PostRepository` / `CommentRepository` /
 *     `AuthVerifier` interfaces as the contract.
 *   - Manually verify the Supabase implementations against a dev
 *     project before deploying.
 *
 * `docs/guides/supabase.md` §11 has the full rationale.
 */

import { createServices, type SupabaseEdgeServices } from './services.js';
import { MemoryAuthVerifier } from './auth-verifier.js';

interface TestServices extends SupabaseEdgeServices {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  // Hand the services factory a pre-built memory verifier so tests
  // can cast `services.authVerifier` back to `MemoryAuthVerifier`
  // in `.setup(services)` to seed users. The cast is type-safe at
  // runtime because we control both ends here.
  const authVerifier = new MemoryAuthVerifier();
  const services = createServices({ mode: 'memory', authVerifier });
  return {
    ...services,
    async cleanup() {
      // Memory state is per-instance, so dropping references is
      // enough for isolation — the next scenario gets fresh
      // repositories. We still explicitly clear the verifier in
      // case the runner pools test services (it doesn't today,
      // but a future change might).
      await authVerifier.clear();
    },
  };
}
