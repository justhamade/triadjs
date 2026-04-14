/**
 * @triadjs/fastify — mount a Triad router onto a Fastify app.
 *
 * Triad's core is HTTP-framework-agnostic. This package is the
 * first-party Fastify adapter: it registers one Fastify route per Triad
 * endpoint, validates incoming request parts against their declared
 * schemas, and dispatches handler responses through Fastify's reply.
 */

export {
  triadPlugin,
  triadPlugin as default,
  type TriadPluginOptions,
} from './plugin.js';

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

export {
  createChannelHandler,
  ChannelHub,
  type ChannelConnection,
  type ChannelHandler,
  type CreateChannelHandlerOptions,
} from './channel-adapter.js';
