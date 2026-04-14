/**
 * `createLambdaHandler` — turn a Triad router into an AWS Lambda entry.
 *
 * The returned function is what your Lambda exports. It handles API
 * Gateway v1 (REST API), API Gateway v2 (HTTP API), Lambda Function URLs
 * (which use the v2 shape), and ALB target events transparently — the
 * event shape is detected per invocation and normalized into an
 * internal request type.
 *
 * Compared to the Express/Hono/Fastify adapters, this handler has two
 * extra responsibilities:
 *
 *   1. Route matching. There's no framework router beneath us, so we
 *      compile each endpoint's path pattern once at build time and
 *      linear-walk the list per request. Small APIs make this fast
 *      enough that a trie isn't worth the complexity.
 *   2. Response serialization. We emit the correct LambdaResult shape
 *      for the event family: API Gateway v2 uses a simpler shape than
 *      v1/ALB, which also support multiValueHeaders.
 *
 * Error envelopes match the other adapters byte-for-byte:
 *   - 400: `{ code: 'VALIDATION_ERROR', message, errors: [...] }`
 *   - 404: `{ code: 'NOT_FOUND', message: 'No handler for <METHOD> <path>.' }`
 *   - 500: `{ code: 'INTERNAL_ERROR', message: 'The server produced an invalid response.' }`
 *
 * WebSocket channels are **not** supported — Lambda is request/response
 * only. Use `@triadjs/fastify` on a long-lived container if you need
 * channels.
 */

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
  Router as TriadRouter,
  buildRespondMap,
  isEmptySchema,
  invokeBeforeHandler,
} from '@triadjs/core';

import type {
  LambdaEvent,
  LambdaResult,
  LambdaContext,
  APIGatewayProxyEventV1,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV1,
  APIGatewayProxyResultV2,
} from './aws-types.js';
import { RequestValidationError, type RequestPart } from './errors.js';
import { coerceByShape } from './coerce.js';
import {
  compilePattern,
  matchPattern,
  type CompiledPattern,
} from './path-matcher.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ServicesResolver =
  | ServiceContainer
  | ((
      event: LambdaEvent,
      context: LambdaContext,
    ) => ServiceContainer | Promise<ServiceContainer>);

export interface CreateLambdaHandlerOptions {
  services?: ServicesResolver;
  /**
   * Optional base path stripped from every incoming request path before
   * route matching. Useful when the function is mounted behind an API
   * Gateway stage (e.g. `/prod`) or ALB listener rule that prefixes
   * paths. The stripped prefix is matched exactly — no trailing slash.
   */
  basePath?: string;
  /** Log hook for server-side failures. Defaults to `console.error`. */
  logError?: (err: unknown, event: LambdaEvent) => void;
}

export type LambdaHandler = (
  event: LambdaEvent,
  context: LambdaContext,
) => Promise<LambdaResult>;

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

type EventFamily = 'v1' | 'v2';

interface NormalizedRequest {
  readonly family: EventFamily;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | undefined>;
  readonly query: Record<string, string | string[] | undefined>;
  readonly body: string | undefined;
  readonly isBase64Encoded: boolean;
}

function isV2Event(event: LambdaEvent): event is APIGatewayProxyEventV2 {
  return (event as { version?: string }).version === '2.0';
}

function lowercaseHeaders(
  raw: Record<string, string | undefined> | null | undefined,
): Record<string, string | undefined> {
  if (!raw) return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function mergeQuery(
  single: Record<string, string | undefined> | null | undefined,
  multi: Record<string, string[] | undefined> | null | undefined,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  if (single) {
    for (const [key, value] of Object.entries(single)) {
      out[key] = value;
    }
  }
  if (multi) {
    for (const [key, values] of Object.entries(multi)) {
      if (values && values.length > 1) {
        out[key] = values;
      } else if (values && values.length === 1 && out[key] === undefined) {
        out[key] = values[0];
      }
    }
  }
  return out;
}

function normalizeEvent(event: LambdaEvent): NormalizedRequest {
  if (isV2Event(event)) {
    const query: Record<string, string | string[] | undefined> = {};
    if (event.queryStringParameters) {
      for (const [key, value] of Object.entries(event.queryStringParameters)) {
        if (value !== undefined && value.includes(',')) {
          query[key] = value.split(',');
        } else {
          query[key] = value;
        }
      }
    }
    return {
      family: 'v2',
      method: event.requestContext.http.method,
      path: event.rawPath,
      headers: lowercaseHeaders(event.headers),
      query,
      body: event.body,
      isBase64Encoded: event.isBase64Encoded,
    };
  }

  const v1 = event satisfies APIGatewayProxyEventV1;
  return {
    family: 'v1',
    method: v1.httpMethod,
    path: v1.path,
    headers: lowercaseHeaders(v1.headers),
    query: mergeQuery(
      v1.queryStringParameters,
      v1.multiValueQueryStringParameters,
    ),
    body: v1.body ?? undefined,
    isBase64Encoded: v1.isBase64Encoded,
  };
}

function decodeBody(
  body: string | undefined,
  isBase64Encoded: boolean,
): string | undefined {
  if (body === undefined) return undefined;
  if (!isBase64Encoded) return body;
  return Buffer.from(body, 'base64').toString('utf-8');
}

// ---------------------------------------------------------------------------
// Response construction
// ---------------------------------------------------------------------------

interface InternalResponse {
  readonly status: number;
  readonly jsonBody?: unknown;
  /** Explicit empty body (e.g. t.empty() returning 204). */
  readonly empty?: boolean;
  /** Extra headers to merge into the response. */
  readonly extraHeaders?: Record<string, string>;
}

function serializeResponse(
  family: EventFamily,
  response: InternalResponse,
): LambdaResult {
  const extra = response.extraHeaders ?? {};

  if (family === 'v2') {
    if (response.empty) {
      const out: APIGatewayProxyResultV2 = {
        statusCode: response.status,
        headers: { ...extra },
        body: '',
        isBase64Encoded: false,
      };
      return out;
    }
    const out: APIGatewayProxyResultV2 = {
      statusCode: response.status,
      headers: { 'content-type': 'application/json', ...extra },
      body: JSON.stringify(response.jsonBody),
      isBase64Encoded: false,
    };
    return out;
  }

  // v1 (API Gateway REST / ALB).
  if (response.empty) {
    const out: APIGatewayProxyResultV1 = {
      statusCode: response.status,
      headers: { ...extra },
      body: '',
      isBase64Encoded: false,
    };
    return out;
  }
  const out: APIGatewayProxyResultV1 = {
    statusCode: response.status,
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(response.jsonBody),
    isBase64Encoded: false,
  };
  return out;
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
// Services
// ---------------------------------------------------------------------------

async function resolveServices(
  services: ServicesResolver | undefined,
  event: LambdaEvent,
  context: LambdaContext,
): Promise<ServiceContainer> {
  if (services === undefined) return {} as ServiceContainer;
  if (typeof services === 'function') {
    return await services(event, context);
  }
  return services;
}

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

function isJsonCompatible(contentType: string): boolean {
  const lower = contentType.toLowerCase().split(';')[0]!.trim();
  return lower === 'application/json' || lower.endsWith('+json');
}

function assertJsonContentType(
  headers: Record<string, string | undefined>,
): void {
  const ct = headers['content-type'] ?? '';
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

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

interface CompiledRoute {
  readonly endpoint: Endpoint;
  readonly pattern: CompiledPattern;
}

function buildRouteTable(router: TriadRouter): CompiledRoute[] {
  return router.allEndpoints().map((endpoint) => ({
    endpoint,
    pattern: compilePattern(endpoint.path),
  }));
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

const defaultLogError = (err: unknown, event: LambdaEvent): void => {
  // eslint-disable-next-line no-console
  console.error('[triad/lambda] handler error', {
    err,
    path: (event as { rawPath?: string; path?: string }).rawPath ??
      (event as { path?: string }).path,
  });
};

function stripBasePath(path: string, basePath: string | undefined): string {
  if (!basePath) return path;
  if (path === basePath) return '/';
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length);
  }
  return path;
}

function notFoundResponse(
  family: EventFamily,
  method: string,
  path: string,
): LambdaResult {
  return serializeResponse(family, {
    status: 404,
    jsonBody: {
      code: 'NOT_FOUND',
      message: `No handler for ${method} ${path}.`,
    },
  });
}

export function createLambdaHandler(
  router: TriadRouter,
  options: CreateLambdaHandlerOptions = {},
): LambdaHandler {
  if (!TriadRouter.isRouter(router)) {
    throw new TypeError(
      '@triadjs/lambda: `router` argument must be a Triad Router instance created with createRouter().',
    );
  }

  const routes = buildRouteTable(router);
  const logError = options.logError ?? defaultLogError;

  return async function triadLambdaHandler(
    event: LambdaEvent,
    context: LambdaContext,
  ): Promise<LambdaResult> {
    const normalized = normalizeEvent(event);
    const pathForMatch = stripBasePath(normalized.path, options.basePath);

    // Find the first endpoint whose method + path pattern match.
    let matched: { route: CompiledRoute; params: Record<string, string> } | undefined;
    for (const route of routes) {
      if (route.endpoint.method !== normalized.method) continue;
      const result = matchPattern(route.pattern, pathForMatch);
      if (result) {
        matched = { route, params: result.params };
        break;
      }
    }

    if (!matched) {
      return notFoundResponse(
        normalized.family,
        normalized.method,
        pathForMatch,
      );
    }

    const { endpoint } = matched.route;

    try {
      const services = await resolveServices(options.services, event, context);
      const respond = buildRespondMap(endpoint.responses);

      // 0.5: beforeHandler — runs BEFORE request schema validation.
      const beforeCtx: BeforeHandlerContext<ResponsesConfig> = {
        rawHeaders: normalized.headers,
        rawQuery: normalized.query,
        rawParams: matched.params,
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
          return serializeResponse(normalized.family, {
            status: scResponse.status,
            empty: true,
          });
        }
        return serializeResponse(normalized.family, {
          status: scResponse.status,
          jsonBody: scResponse.body,
        });
      }
      const beforeState = beforeResult.state;

      // 1 + 2: validate each request part. Params come from the path
      // matcher, not the raw event — AWS's pathParameters is only
      // populated for proxy integrations with matching resource templates.
      const params = validatePart(
        endpoint,
        'params',
        matched.params,
      ) as Record<string, unknown>;
      const query = validatePart(
        endpoint,
        'query',
        normalized.query,
      ) as Record<string, unknown>;
      const headers = validatePart(
        endpoint,
        'headers',
        normalized.headers,
      ) as Record<string, unknown>;

      // Body: decode base64 if needed, then parse JSON when present.
      const rawBody = decodeBody(normalized.body, normalized.isBase64Encoded);
      let parsedBody: unknown = undefined;
      if (rawBody !== undefined && rawBody !== '' && endpoint.request.body) {
        assertJsonContentType(normalized.headers);
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          throw new RequestValidationError('body', [
            {
              path: '',
              message: 'Request body is not valid JSON.',
              code: 'invalid_json',
            },
          ]);
        }
      }
      const body = validatePart(endpoint, 'body', parsedBody);

      // 4: build the handler context.
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

      const declared = endpoint.responses[response.status];
      if (declared && isEmptySchema(declared.schema)) {
        return serializeResponse(normalized.family, {
          status: response.status,
          empty: true,
          extraHeaders: response.headers,
        });
      }
      return serializeResponse(normalized.family, {
        status: response.status,
        jsonBody: response.body,
        extraHeaders: response.headers,
      });
    } catch (err) {
      if (err instanceof RequestValidationError) {
        return serializeResponse(normalized.family, {
          status: 400,
          jsonBody: {
            code: 'VALIDATION_ERROR',
            message: err.message,
            errors: err.errors,
          },
        });
      }
      if (err instanceof ValidationException) {
        logError(err, event);
        return serializeResponse(normalized.family, {
          status: 500,
          jsonBody: {
            code: 'INTERNAL_ERROR',
            message: 'The server produced an invalid response.',
          },
        });
      }
      logError(err, event);
      return serializeResponse(normalized.family, {
        status: 500,
        jsonBody: {
          code: 'INTERNAL_ERROR',
          message: 'The server produced an unexpected error.',
        },
      });
    }
  };
}
