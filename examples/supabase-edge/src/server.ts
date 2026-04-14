/**
 * Node dev server entry point.
 *
 * This file runs on Node via `@hono/node-server`. It's the "run it
 * on my laptop" path — `npm run dev` starts it, and you can curl
 * endpoints against `http://localhost:3300` without needing a
 * Supabase project or the Supabase CLI.
 *
 * The dev server wires up the MEMORY services, not the Supabase
 * ones: a `MemoryPostRepository`, a `MemoryCommentRepository`, and
 * a `MemoryAuthVerifier` pre-seeded with one dev user. That gives
 * a frictionless out-of-the-box experience — `npm install && npm
 * run dev`, then use the printed token to curl `/posts`.
 *
 * To hit real Supabase locally, you either:
 *
 *   1. Run `supabase start` (requires Docker) to spin up a local
 *      Supabase stack, then swap this file to `mode: 'supabase'`
 *      with a client pointed at the local stack, OR
 *   2. Deploy to a real Supabase project via
 *      `supabase functions deploy api` and exercise the deployed
 *      function. That path uses `supabase/functions/api/index.ts`,
 *      NOT this file.
 *
 * This dev server is intentionally simple — no auth caching, no
 * graceful shutdown wiring, no structured logging. Everything you'd
 * want for a production Node deployment belongs in a wrapper around
 * `@triadjs/hono`, not here.
 *
 * ## createApp factory
 *
 * `createApp()` returns a ready-to-serve Hono app and its service
 * container without calling `serve()`. The e2e test harness wires up
 * its own `serve({ fetch, port: 0 })` so each test gets an ephemeral
 * port. `npm run dev` still starts a server via the module-entry
 * guard below.
 */

import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { createTriadApp } from '@triadjs/hono';

import router from './app.js';
import { createServices, type SupabaseEdgeServices } from './services.js';
import { MemoryAuthVerifier } from './auth-verifier.js';

export interface CreateAppOptions {
  /** Provide pre-built services (e.g. with a pre-seeded memory verifier). */
  services?: SupabaseEdgeServices;
}

export interface CreatedApp {
  app: ReturnType<typeof createTriadApp>;
  services: SupabaseEdgeServices;
}

export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const services =
    options.services ??
    createServices({ mode: 'memory', authVerifier: new MemoryAuthVerifier() });
  const app = createTriadApp(router, { services });
  return { app, services };
}

const isMainEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const authVerifier = new MemoryAuthVerifier();
  const services = createServices({ mode: 'memory', authVerifier });

  // Seed a single dev user so `npm run dev` is immediately useful.
  const devToken = authVerifier.register({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'dev@example.com',
    name: 'Dev User',
  });

  const { app } = createApp({ services });
  const port = Number(process.env['PORT'] ?? 3300);
  serve({ fetch: app.fetch, port });

  // eslint-disable-next-line no-console
  console.log(
    `[supabase-edge] dev server listening on http://localhost:${port}\n` +
      `[supabase-edge] try: curl -H "Authorization: Bearer ${devToken}" http://localhost:${port}/me`,
  );
}
