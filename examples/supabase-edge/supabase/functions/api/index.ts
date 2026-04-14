// Deno entry point for the Supabase Edge Function deployment.
//
// IMPORTANT: This file is compiled and run by Deno (the Supabase
// Edge Runtime), NOT by tsc or Node. That's why you'll see all of
// the following in one file:
//
//   - The global `Deno` namespace (declared below since @types/node
//     doesn't have it).
//   - `.ts` extensions in relative imports — Deno requires them;
//     Node's ESM resolver rejects them unless you configure it.
//   - `https://esm.sh/...` remote imports — Deno native, Node can't
//     resolve them without a loader.
//   - `npm:@triadjs/...@*` specifiers — Deno-native npm interop.
//
// `tsconfig.json` in the example root excludes `supabase/**/*`
// so `npm run typecheck` stays green. If you edit this file, run
// `supabase functions deploy api` (or `deno check`) for type
// validation — tsc will (intentionally) not see it.
//
// Deploy with:
//
//   supabase functions deploy api
//
// Required environment variables (set via `supabase secrets`):
//
//   SUPABASE_URL       — your project's https://<ref>.supabase.co URL
//   SUPABASE_ANON_KEY  — the project's anon/public key
//
// Per-request clients are initialized with the caller's Authorization
// header so Supabase Row-Level Security policies run as the caller,
// NOT as the service role. That's the defense-in-depth story: even
// if the Triad authorization check has a bug, RLS still enforces the
// rule at the Postgres layer. See `docs/guides/supabase.md` §5.

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Deno {
  export const env: {
    get(name: string): string | undefined;
  };
  export function serve(handler: (req: Request) => Promise<Response>): void;
}

// Remote import — Deno resolves at deploy time. Pinned minor to
// avoid silent breaking changes when supabase-js ships a new major.
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Bare `npm:` specifiers — Deno resolves these to the npm registry.
// `@*` means "latest published version"; in a real deployment you'd
// pin to whatever is in your lockfile.
// eslint-disable-next-line import/no-unresolved
import { createTriadApp } from 'npm:@triadjs/hono@*';

// Local imports use explicit `.ts` extensions so Deno's module
// resolver can find them. Note these point up and out of the
// `supabase/functions/api` directory into the main `src/` tree —
// one shared router, two runtimes.
import router from '../../../src/app.ts';
import { createServices } from '../../../src/services.ts';

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        code: 'CONFIG_ERROR',
        message: 'SUPABASE_URL and SUPABASE_ANON_KEY must be set.',
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  // Forward the caller's Authorization header so every Postgres
  // query this request makes runs under the caller's JWT — and
  // therefore under the RLS policies defined for their role.
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });

  const services = await createServices({ mode: 'supabase', supabase });
  const app = createTriadApp(router, { services });
  return app.fetch(req);
});
