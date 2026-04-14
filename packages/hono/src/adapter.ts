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
  type BeforeHandlerContext,
  type TriadFile,
  ValidationException,
  buildRespondMap,
  isEmptySchema,
  invokeBeforeHandler,
  hasFileFields,
} from '@triadjs/core';

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

function dispatch(
  c: AnyContext,
  endpoint: Endpoint,
  response: HandlerResponse,
): Response {
  const status = response.status;

  // Primary path: schema-driven. If the endpoint declared `t.empty()`
  // for this status, we know to send no body with no content-type.
  const declared = endpoint.responses[status];
  if (declared && isEmptySchema(declared.schema)) {
    return c.body(null, status as StatusCode);
  }

  // Defensive fallback: even if a user forgot to declare `t.empty()`,
  // per the HTTP spec 204/205/304 MUST NOT carry a body. We'd rather
  // silently drop the body than emit a malformed response.
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

function internalErrorResponse(
  c: AnyContext,
  message = 'The server produced an invalid response.',
): Response {
  return c.json(
    {
      code: 'INTERNAL_ERROR',
      message,
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

async function readMultipartBody(
  c: AnyContext,
): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new RequestValidationError('body', [
      {
        path: '',
        code: 'expected_multipart',
        message: 'Expected multipart/form-data request',
      },
    ]);
  }
  let parsed: Record<string, string | File | (string | File)[]>;
  try {
    parsed = (await c.req.parseBody({ all: true })) as Record<
      string,
      string | File | (string | File)[]
    >;
  } catch {
    throw new RequestValidationError('body', [
      {
        path: '',
        code: 'invalid_multipart',
        message: 'Request body is not a valid multipart/form-data payload',
      },
    ]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      out[key] = await Promise.all(value.map(normalizeFormValue));
    } else {
      out[key] = await normalizeFormValue(value);
    }
  }
  return out;
}

async function normalizeFormValue(
  value: string | File,
): Promise<string | TriadFile> {
  if (typeof value === 'string') return value;
  const arrayBuffer = await value.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const file: TriadFile = {
    name: value.name,
    mimeType: value.type || 'application/octet-stream',
    size: buffer.length,
    buffer,
    stream: () => bufferToStream(buffer),
  };
  return file;
}

function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

function isJsonCompatible(contentType: string): boolean {
  const lower = contentType.toLowerCase().split(';')[0]!.trim();
  return lower === 'application/json' || lower.endsWith('+json');
}

function assertJsonContentType(c: AnyContext): void {
  const ct = c.req.header('content-type') ?? '';
  if (!isJsonCompatible(ct)) {
    throw new RequestValidationError('body', [
      {
        path: '',
        code: 'invalid_content_type',
        message: 'Expected application/json content type',
      },
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
  const bodyIsMultipart =
    endpoint.request.body !== undefined && hasFileFields(endpoint.request.body);

  return async function triadRouteHandler(c: AnyContext): Promise<Response> {
    try {
      const rawParams = c.req.param() as Record<string, string>;
      const rawQuery = c.req.query() as Record<string, string>;
      const rawHeaders = c.req.header() as Record<string, string>;

      // 0: resolve services (needed by beforeHandler and main handler).
      const services = await resolveServices(options.services, c.req.raw);
      const respond = buildRespondMap(endpoint.responses);

      // 0.5: beforeHandler — runs BEFORE request schema validation.
      const beforeCtx: BeforeHandlerContext<ResponsesConfig> = {
        rawHeaders: rawHeaders as Record<
          string,
          string | string[] | undefined
        >,
        rawQuery: rawQuery as Record<
          string,
          string | string[] | undefined
        >,
        rawParams,
        rawCookies: {},
        services,
        respond,
      };
      const beforeResult = await invokeBeforeHandler(
        endpoint.beforeHandler,
        beforeCtx,
      );
      if (!beforeResult.ok) {
        return dispatch(c, endpoint, beforeResult.response);
      }
      const beforeState = beforeResult.state;

      // 1 + 2: coerce and validate each request part.
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
        if (bodyIsMultipart) {
          body = validatePart(endpoint, 'body', await readMultipartBody(c));
        } else {
          assertJsonContentType(c);
          body = validatePart(endpoint, 'body', await readJsonBody(c));
        }
      }

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

      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          c.header(key, value);
        }
      }

      return dispatch(c, endpoint, response);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        return validationErrorResponse(c, err);
      }
      if (err instanceof ValidationException) {
        logError(err, c.req.raw);
        return internalErrorResponse(c);
      }
      logError(err, c.req.raw);
      return internalErrorResponse(c, 'The server produced an unexpected error.');
    }
  };
}
