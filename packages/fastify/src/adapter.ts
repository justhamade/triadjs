/**
 * Core adapter: convert a single Triad `Endpoint` into a Fastify route
 * handler. The plugin module iterates over the router's endpoints and
 * registers one route per endpoint using the handler produced here.
 *
 * The handler wrapper does five things in order:
 *
 *   1. Coerce incoming params/query/headers strings to their target JS
 *      types (int32 → number, boolean → true/false). Body values already
 *      have the right types because Fastify parses JSON before us.
 *   2. Validate each request part against its declared schema. A
 *      failure throws `RequestValidationError`, which the route handler
 *      catches and maps to a 400 response with structured error details.
 *   3. Resolve the services container. `services` may be a plain object
 *      for simple apps or a factory function for per-request services
 *      (auth scopes, tenant DB connections, etc).
 *   4. Build a `HandlerContext` with the validated data and `respond`
 *      map built from the endpoint's declared responses. `ctx.respond`
 *      validates outgoing payloads on the way out — a Phase 2 guarantee
 *      preserved here.
 *   5. Invoke the user handler, capture its `HandlerResponse`, and map
 *      status + body to Fastify's `reply.code(...).send(...)`.
 *
 * Any `ValidationException` thrown from `ctx.respond` (meaning the
 * handler returned a body that does not match its declared schema) is
 * caught and mapped to a 500 — a response-validation failure is a
 * server-side bug and should never leak invalid data to the client.
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  RouteHandlerMethod,
} from 'fastify';

import {
  type Endpoint,
  type HandlerContext,
  type HandlerResponse,
  type ResponsesConfig,
  type ServiceContainer,
  type ModelShape,
  type ValidationError,
  type BeforeHandlerContext,
  ValidationException,
  buildRespondMap,
  isEmptySchema,
  invokeBeforeHandler,
} from '@triad/core';

import { RequestValidationError, type RequestPart } from './errors.js';
import { coerceByShape } from './coerce.js';

// ---------------------------------------------------------------------------
// Services resolver
// ---------------------------------------------------------------------------

export type ServicesResolver =
  | ServiceContainer
  | ((
      request: FastifyRequest,
    ) => ServiceContainer | Promise<ServiceContainer>);

async function resolveServices(
  services: ServicesResolver | undefined,
  request: FastifyRequest,
): Promise<ServiceContainer> {
  if (services === undefined) return {} as ServiceContainer;
  if (typeof services === 'function') {
    return await services(request);
  }
  return services;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface NormalizedRequestPart {
  readonly shape: ModelShape;
  readonly validate: (
    data: unknown,
  ) =>
    | { success: true; data: unknown }
    | { success: false; errors: ValidationError[] };
}

function partFromEndpoint(
  endpoint: Endpoint,
  part: RequestPart,
): NormalizedRequestPart | undefined {
  if (part === 'body') {
    const body = endpoint.request.body;
    if (!body) return undefined;
    return {
      shape: {},
      validate: (data) => body.validate(data),
    };
  }
  const model = endpoint.request[part];
  if (!model) return undefined;
  return {
    shape: model.shape as ModelShape,
    validate: (data) => model.validate(data),
  };
}

function validatePart(
  endpoint: Endpoint,
  part: RequestPart,
  rawValue: unknown,
): unknown {
  const spec = partFromEndpoint(endpoint, part);
  if (!spec) {
    // No schema declared for this part → pass the raw value through.
    return rawValue;
  }

  // For body, skip coercion (Fastify already parsed JSON). For other
  // parts, coerce scalars from the incoming string-typed values.
  const coerced =
    part === 'body' ? rawValue : coerceByShape(spec.shape, rawValue);

  const result = spec.validate(coerced);
  if (!result.success) {
    throw new RequestValidationError(part, result.errors);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface CreateHandlerOptions {
  services?: ServicesResolver;
  /** Log hook for server-side failures (defaults to `fastify.log.error`). */
  logError?: (err: unknown, request: FastifyRequest) => void;
}

/**
 * Build a Fastify route handler for a single Triad endpoint.
 */
export function createRouteHandler(
  fastify: FastifyInstance,
  endpoint: Endpoint,
  options: CreateHandlerOptions = {},
): RouteHandlerMethod {
  const logError =
    options.logError ??
    ((err, request) =>
      fastify.log.error({ err, url: request.url }, 'Triad handler error'));

  return async function triadRouteHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      // 0: resolve services (needed by beforeHandler and main handler).
      const services = await resolveServices(options.services, request);
      const respond = buildRespondMap(endpoint.responses);

      // 0.5: beforeHandler — runs BEFORE request schema validation so
      // auth can reject missing/malformed inputs as 401/403 rather than
      // the adapter 400-ing them during validation.
      const beforeCtx: BeforeHandlerContext<ResponsesConfig> = {
        rawHeaders: request.headers as Record<
          string,
          string | string[] | undefined
        >,
        rawQuery: request.query as Record<
          string,
          string | string[] | undefined
        >,
        rawParams: request.params as Record<string, string>,
        rawCookies: {},
        services,
        respond,
      };
      const beforeResult = await invokeBeforeHandler(
        endpoint.beforeHandler,
        beforeCtx,
      );
      if (!beforeResult.ok) {
        const scResponse = beforeResult.response;
        const declared = endpoint.responses[scResponse.status];
        if (declared && isEmptySchema(declared.schema)) {
          reply.code(scResponse.status).send();
          return;
        }
        reply.code(scResponse.status).send(scResponse.body);
        return;
      }
      const beforeState = beforeResult.state;

      // 1 + 2: coerce and validate each request part.
      const params = validatePart(endpoint, 'params', request.params) as Record<
        string,
        unknown
      >;
      const query = validatePart(endpoint, 'query', request.query) as Record<
        string,
        unknown
      >;
      const headers = validatePart(endpoint, 'headers', request.headers) as Record<
        string,
        unknown
      >;
      const body = validatePart(endpoint, 'body', request.body);

      // 4: build context. The handler's declared generic parameters are
      // only known at endpoint definition time — at runtime we treat the
      // context as opaque and let the user handler see the validated data
      // under its narrow type.
      const ctx = {
        params,
        query,
        body,
        headers,
        services,
        state: beforeState,
        respond,
      };

      // 5: invoke the user handler and dispatch the response.
      const response: HandlerResponse = await endpoint.handler(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx as HandlerContext<any, any, any, any, ResponsesConfig>,
      );

      // If the response schema for this status is `t.empty()`, send with
      // no body so Fastify omits `Content-Type: application/json`. This
      // is how 204/205/304 ought to travel over the wire.
      const declared = endpoint.responses[response.status];
      if (declared && isEmptySchema(declared.schema)) {
        reply.code(response.status).send();
        return;
      }
      reply.code(response.status).send(response.body);
      return;
    } catch (err) {
      if (err instanceof RequestValidationError) {
        reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: err.message,
          errors: err.errors,
        });
        return;
      }
      if (err instanceof ValidationException) {
        // Response body did not match the declared schema — server bug.
        logError(err, request);
        reply.code(500).send({
          code: 'INTERNAL_ERROR',
          message: 'The server produced an invalid response.',
        });
        return;
      }
      // Unknown errors: let Fastify's default error handler deal with them.
      throw err;
    }
  };
}
