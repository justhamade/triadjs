/**
 * @triad/hono — mount a Triad router onto a Hono application.
 *
 * Triad's core is HTTP-framework-agnostic. This package is the
 * first-party Hono adapter: it builds a fresh `Hono` app containing
 * one route per Triad endpoint, validates incoming request parts
 * against their declared schemas, and dispatches handler responses via
 * `c.json(...)` / `c.body(null, ...)`.
 *
 * Use this when you want Triad on an edge runtime (Cloudflare Workers,
 * Deno, Bun, Fastly, Lagon) — Hono is Web Fetch API native and runs
 * anywhere a `Request`/`Response` handler can run.
 *
 * WebSocket channels are **not** supported in v1 — use `@triad/fastify`
 * if you need channel support.
 */

export {
  createTriadApp,
  type CreateTriadAppOptions,
} from './app.js';

export {
  createRouteHandler,
  type ServicesResolver,
  type CreateHandlerOptions,
} from './adapter.js';

export {
  RequestValidationError,
  type RequestPart,
} from './errors.js';

export { coerceScalar, coerceByShape } from './coerce.js';
