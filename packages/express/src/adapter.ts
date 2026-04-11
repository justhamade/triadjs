/**
 * Core adapter: convert a single Triad `Endpoint` into an Express route
 * handler. `createTriadRouter` iterates a Triad router's endpoints and
 * mounts one express handler per endpoint using the factory here.
 *
 * The handler wrapper does five things in order:
 *
 *   1. Coerce incoming params/query/headers strings to their target JS
 *      types (int32 → number, boolean → true/false). Body values already
 *      have the right types because `express.json()` middleware parses
 *      JSON before us.
 *   2. Validate each request part against its declared schema. A
 *      failure throws `RequestValidationError`, which the route handler
 *      catches and maps to a 400 response with structured error details.
 *   3. Resolve the services container. `services` may be a plain object
 *      for simple apps or a factory function for per-request services
 *      (auth scopes, tenant DB connections, etc).
 *   4. Build a `HandlerContext` with the validated data and `respond`
 *      map built from the endpoint's declared responses.
 *   5. Invoke the user handler, capture its `HandlerResponse`, and map
 *      status + body to `res.status(...).json(...)`.
 *
 * Any `ValidationException` thrown from `ctx.respond` (meaning the
 * handler returned a body that does not match its declared schema) is
 * caught and mapped to a 500 — a response-validation failure is a
 * server-side bug and should never leak invalid data to the client.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

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
  | ((req: Request) => ServiceContainer | Promise<ServiceContainer>);

async function resolveServices(
  services: ServicesResolver | undefined,
  req: Request,
): Promise<ServiceContainer> {
  if (services === undefined) return {} as ServiceContainer;
  if (typeof services === 'function') {
    return await services(req);
  }
  return services;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

type ValidateResult =
  | { success: true; data: unknown }
  | { success: false; errors: ValidationError[] };

interface NormalizedRequestPart {
  readonly shape: ModelShape;
  readonly validate: (data: unknown) => ValidateResult;
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
  if (!spec) return rawValue;

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
  /** Log hook for server-side failures (defaults to `console.error`). */
  logError?: (err: unknown, req: Request) => void;
}

const defaultLogError = (err: unknown, req: Request): void => {
  // eslint-disable-next-line no-console
  console.error('[triad/express] handler error', { err, url: req.url });
};

/**
 * Build an Express route handler for a single Triad endpoint.
 */
export function createRouteHandler(
  endpoint: Endpoint,
  options: CreateHandlerOptions = {},
): RequestHandler {
  const logError = options.logError ?? defaultLogError;

  return async function triadRouteHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // 0: resolve services (needed by beforeHandler and main handler).
      const services = await resolveServices(options.services, req);
      const respond = buildRespondMap(endpoint.responses);

      // 0.5: beforeHandler — runs BEFORE request schema validation.
      const beforeCtx: BeforeHandlerContext<ResponsesConfig> = {
        rawHeaders: req.headers as Record<
          string,
          string | string[] | undefined
        >,
        rawQuery: req.query as Record<
          string,
          string | string[] | undefined
        >,
        rawParams: req.params as Record<string, string>,
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
          res.status(scResponse.status).end();
          return;
        }
        res.status(scResponse.status).json(scResponse.body);
        return;
      }
      const beforeState = beforeResult.state;

      // 1 + 2: coerce and validate each request part.
      const params = validatePart(endpoint, 'params', req.params) as Record<
        string,
        unknown
      >;
      const query = validatePart(endpoint, 'query', req.query) as Record<
        string,
        unknown
      >;
      const headers = validatePart(endpoint, 'headers', req.headers) as Record<
        string,
        unknown
      >;
      const body = validatePart(endpoint, 'body', req.body);

      // 4: build context.
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

      // `t.empty()` responses send no body and no `Content-Type` header —
      // `res.end()` explicitly avoids the JSON content-type that
      // `res.json()` would attach.
      const declared = endpoint.responses[response.status];
      if (declared && isEmptySchema(declared.schema)) {
        res.status(response.status).end();
        return;
      }
      res.status(response.status).json(response.body);
      return;
    } catch (err) {
      if (err instanceof RequestValidationError) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: err.message,
          errors: err.errors,
        });
        return;
      }
      if (err instanceof ValidationException) {
        logError(err, req);
        res.status(500).json({
          code: 'INTERNAL_ERROR',
          message: 'The server produced an invalid response.',
        });
        return;
      }
      // Unknown errors: defer to the next error-handling middleware
      // (usually `triadErrorHandler()` or express's default).
      next(err);
    }
  };
}
