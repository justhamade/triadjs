/**
 * @triadjs/express — mount a Triad router onto an Express application.
 *
 * Triad's core is HTTP-framework-agnostic. This package is the
 * first-party Express adapter: it builds an `express.Router` containing
 * one route per Triad endpoint, validates incoming request parts
 * against their declared schemas, and dispatches handler responses via
 * express's `res.status().json()`.
 *
 * WebSocket channels are **not** supported in v1 — use `@triadjs/fastify`
 * if you need channel support.
 */

export {
  createTriadRouter,
  type CreateTriadRouterOptions,
} from './router.js';

export type { DocsOption } from '@triadjs/openapi';

export {
  createRouteHandler,
  type ServicesResolver,
  type CreateHandlerOptions,
} from './adapter.js';

export {
  triadErrorHandler,
  type TriadErrorHandlerOptions,
} from './error-handler.js';

export {
  RequestValidationError,
  type RequestPart,
} from './errors.js';

export { coerceScalar, coerceByShape } from './coerce.js';
