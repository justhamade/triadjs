/**
 * The `endpoint()` declarative API.
 *
 * An endpoint is a single HTTP resource — method + path + schemas + handler +
 * behaviors — defined as one configuration object. This is Triad's bedrock
 * "single source of truth": the one object produces types, validation,
 * OpenAPI, Gherkin, and tests.
 *
 * ```ts
 * export const createPet = endpoint({
 *   name: 'createPet',
 *   method: 'POST',
 *   path: '/pets',
 *   summary: 'Create a new pet',
 *   tags: ['Pets'],
 *   request: { body: CreatePet },
 *   responses: {
 *     201: { schema: Pet, description: 'Pet created' },
 *     400: { schema: ApiError, description: 'Validation error' },
 *   },
 *   handler: async (ctx) => {
 *     const pet = await ctx.services.petRepo.create(ctx.body);
 *     return ctx.respond[201](pet);
 *   },
 *   behaviors: [ ... ],
 * });
 * ```
 */

import type { SchemaNode } from './schema/types.js';
import { ModelSchema } from './schema/model.js';
import type {
  HandlerContext,
  HandlerResponse,
  ResponsesConfig,
} from './context.js';
import type { Behavior } from './behavior.js';

// ---------------------------------------------------------------------------
// Declarative config (author-facing)
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestConfig<TParams, TQuery, TBody, THeaders> {
  params?: TParams;
  query?: TQuery;
  body?: TBody;
  headers?: THeaders;
}

export interface EndpointConfig<
  TParams,
  TQuery,
  TBody,
  THeaders,
  TResponses extends ResponsesConfig,
> {
  name: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags?: readonly string[];
  request?: RequestConfig<TParams, TQuery, TBody, THeaders>;
  responses: TResponses;
  handler: (
    ctx: HandlerContext<TParams, TQuery, TBody, THeaders, TResponses>,
  ) => Promise<HandlerResponse>;
  behaviors?: readonly Behavior[];
}

// ---------------------------------------------------------------------------
// Endpoint data structure (runtime)
// ---------------------------------------------------------------------------

export interface NormalizedRequest {
  /** Path parameters, normalized to a `ModelSchema` (anonymous if inline). */
  params?: ModelSchema<Record<string, SchemaNode>>;
  /** Query parameters, normalized to a `ModelSchema` (anonymous if inline). */
  query?: ModelSchema<Record<string, SchemaNode>>;
  /** Request body schema (already a `SchemaNode`). */
  body?: SchemaNode;
  /** Header schema, normalized to a `ModelSchema` (anonymous if inline). */
  headers?: ModelSchema<Record<string, SchemaNode>>;
}

/** Runtime representation of an endpoint — consumed by the router and CLI. */
export interface Endpoint {
  name: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  request: NormalizedRequest;
  responses: ResponsesConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: HandlerContext<any, any, any, any, any>) => Promise<HandlerResponse>;
  behaviors: Behavior[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a `params`/`query`/`headers` value into a `ModelSchema`.
 *
 * The author can pass either:
 *   - A named `ModelSchema` (used as-is), or
 *   - An inline object of `SchemaNode`s — wrapped in an anonymous `ModelSchema`
 *     with a synthesized name.
 */
function normalizeRequestPart(
  value: unknown,
  anonymousName: string,
): ModelSchema<Record<string, SchemaNode>> | undefined {
  if (value === undefined) return undefined;
  if (value instanceof ModelSchema) {
    return value as ModelSchema<Record<string, SchemaNode>>;
  }
  // Inline shape object — wrap it.
  const shape = value as Record<string, SchemaNode>;
  return new ModelSchema(anonymousName, shape);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Define an HTTP endpoint. Returns a normalized `Endpoint` runtime object
 * while preserving full type inference across `ctx.params`, `ctx.query`,
 * `ctx.body`, `ctx.headers`, and `ctx.respond[...]`.
 */
export function endpoint<
  TParams,
  TQuery,
  TBody,
  THeaders,
  TResponses extends ResponsesConfig,
>(
  config: EndpointConfig<TParams, TQuery, TBody, THeaders, TResponses>,
): Endpoint {
  const request = config.request ?? {};
  return {
    name: config.name,
    method: config.method,
    path: config.path,
    summary: config.summary,
    description: config.description,
    tags: config.tags ? [...config.tags] : [],
    request: {
      params: normalizeRequestPart(request.params, `${config.name}Params`),
      query: normalizeRequestPart(request.query, `${config.name}Query`),
      body: request.body as SchemaNode | undefined,
      headers: normalizeRequestPart(request.headers, `${config.name}Headers`),
    },
    responses: config.responses,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: config.handler as any,
    behaviors: config.behaviors ? [...config.behaviors] : [],
  };
}
