/**
 * Core adapter: convert a single Triad `Endpoint` into a Hono route
 * handler. `createTriadApp` iterates a Triad router's endpoints and
 * mounts one Hono handler per endpoint using the factory here.
 *
 * The handler wrapper does five things in order:
 *
 *   1. Coerce incoming params/query/headers strings to their target JS
 *      types (int32 → number, boolean → true/false). Body values already
 *      have the right types because we call `c.req.json()` before
 *      validation runs.
 *   2. Validate each request part against its declared schema. A
 *      failure throws `RequestValidationError`, which the wrapper
 *      catches and maps to a 400 response.
 *   3. Resolve the services container. `services` may be a plain object
 *      for simple apps or a factory function for per-request services
 *      (auth scopes, tenant DB connections, etc) receiving the standard
 *      Fetch `Request`.
 *   4. Build a `HandlerContext` with the validated data and `respond`
 *      map built from the endpoint's declared responses.
 *   5. Invoke the user handler, capture its `HandlerResponse`, and
 *      dispatch via `c.json(body, status)` — or `c.body(null, status)`
 *      for empty bodies (204, etc).
 *
 * Any `ValidationException` thrown from `ctx.respond` (meaning the
 * handler returned a body that does not match its declared schema) is
 * caught and mapped to a 500 — a response-validation failure is a
 * server-side bug and should never leak invalid data to the client.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';

import {
  type Endpoint,
  type HandlerContext,
  type HandlerResponse,
  type ResponsesConfig,
  type ServiceContainer,
  type ModelShape,
  type ValidationError,
  ValidationException,
  buildRespondMap,
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
// Hono handler factory
// ---------------------------------------------------------------------------

export interface CreateHandlerOptions {
  services?: ServicesResolver;
  /** Log hook for server-side failures (defaults to `console.error`). */
  logError?: (err: unknown, req: Request) => void;
}

const defaultLogError = (err: unknown, req: Request): void => {
  // eslint-disable-next-line no-console
  console.error('[triad/hono] handler error', { err, url: req.url });
};

/** Any Hono context — we type request parts ourselves via coercion. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContext = Context<any, any, any>;

type HonoHandler = (c: AnyContext) => Promise<Response>;

const EMPTY_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

function dispatch(c: AnyContext, response: HandlerResponse): Response {
  const status = response.status;
  if (EMPTY_BODY_STATUSES.has(status) || response.body === undefined) {
    return c.body(null, status as StatusCode);
  }
  // Hono's json() overloads require ContentfulStatusCode; our status
  // came from the endpoint's declared responses so this narrowing is
  // safe at runtime.
  return c.json(
    response.body as Record<string, unknown>,
    status as ContentfulStatusCode,
  );
}

function validationErrorResponse(
  c: AnyContext,
  err: RequestValidationError,
): Response {
  return c.json(
    {
      code: 'VALIDATION_ERROR',
      message: err.message,
      errors: err.errors,
    },
    400,
  );
}

function internalErrorResponse(c: AnyContext): Response {
  return c.json(
    {
      code: 'INTERNAL_ERROR',
      message: 'The server produced an invalid response.',
    },
    500,
  );
}

async function readJsonBody(c: AnyContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RequestValidationError('body', [
      { path: '', message: 'Request body is not valid JSON', code: 'invalid_json' },
    ]);
  }
}

const METHODS_WITH_BODY: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
]);

/**
 * Build a Hono route handler for a single Triad endpoint.
 */
export function createRouteHandler(
  endpoint: Endpoint,
  options: CreateHandlerOptions = {},
): HonoHandler {
  const logError = options.logError ?? defaultLogError;
  const hasBody = METHODS_WITH_BODY.has(endpoint.method);

  return async function triadRouteHandler(c: AnyContext): Promise<Response> {
    try {
      // 1 + 2: coerce and validate each request part.
      const rawParams = c.req.param();
      const rawQuery = c.req.query();
      const rawHeaders = c.req.header();

      const params = validatePart(endpoint, 'params', rawParams) as Record<
        string,
        unknown
      >;
      const query = validatePart(endpoint, 'query', rawQuery) as Record<
        string,
        unknown
      >;
      const headers = validatePart(endpoint, 'headers', rawHeaders) as Record<
        string,
        unknown
      >;

      let body: unknown = undefined;
      if (hasBody && endpoint.request.body) {
        const raw = await readJsonBody(c);
        body = validatePart(endpoint, 'body', raw);
      }

      // 3: resolve services.
      const services = await resolveServices(options.services, c.req.raw);

      // 4: build context.
      const ctx = {
        params,
        query,
        body,
        headers,
        services,
        respond: buildRespondMap(endpoint.responses),
      };

      // 5: invoke the user handler and dispatch the response.
      const response: HandlerResponse = await endpoint.handler(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx as HandlerContext<any, any, any, any, ResponsesConfig>,
      );

      return dispatch(c, response);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        return validationErrorResponse(c, err);
      }
      if (err instanceof ValidationException) {
        logError(err, c.req.raw);
        return internalErrorResponse(c);
      }
      // Unknown errors: let Hono's onError handle it.
      throw err;
    }
  };
}
