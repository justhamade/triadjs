/**
 * Handler context and response typing for Triad endpoints.
 *
 * `HandlerContext` is what an endpoint's `handler` receives. It bundles:
 *   - `params`, `query`, `body`, `headers` — each typed from their declared
 *     schemas in the endpoint's `request` configuration.
 *   - `services` — the user-extensible service container (via declaration
 *     merging on `ServiceContainer`).
 *   - `respond` — a type-safe map keyed by declared response status codes.
 *     Each key is a function that accepts *only* data matching that status'
 *     schema, so `ctx.respond[500](...)` is a compile error unless 500 is
 *     declared in `responses`.
 */

import type { SchemaNode } from './schema/types.js';
import type { ModelSchema, InferShape } from './schema/model.js';
import { isEmptySchema, type EmptySchema } from './schema/empty.js';

// ---------------------------------------------------------------------------
// Service container (user-extensible)
// ---------------------------------------------------------------------------

/**
 * The shared service container injected into every handler's context.
 *
 * Users add their own services via declaration merging:
 *
 * ```ts
 * declare module '@triad/core' {
 *   interface ServiceContainer {
 *     petRepo: PetRepository;
 *     eventBus: EventBus;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServiceContainer {}

// ---------------------------------------------------------------------------
// Response configuration
// ---------------------------------------------------------------------------

export interface ResponseConfig {
  schema: SchemaNode;
  description: string;
}

export type ResponsesConfig = Record<number, ResponseConfig>;

export interface HandlerResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

type InferSchema<T> = T extends SchemaNode<infer U> ? U : never;

/**
 * Type-safe response map. Given the endpoint's declared `responses`, produces
 * a map keyed by status code where each value is a function accepting the
 * inferred schema type for that status.
 *
 * ```ts
 * responses: {
 *   201: { schema: Pet, description: 'Created' },
 *   404: { schema: ApiError, description: 'Not found' },
 * }
 *
 * ctx.respond[201](pet)        // OK
 * ctx.respond[201]({ bad: 1 }) // compile error
 * ctx.respond[500]('x')        // compile error — not declared
 * ```
 */
export type ResponseOptions = {
  headers?: Record<string, string>;
};

/**
 * Conditional: if the declared schema for a status is `EmptySchema`, the
 * responder is a zero-argument function (with optional response options).
 * Otherwise it takes the inferred body type plus optional response options.
 * This powers the `t.empty()` ergonomics for 204/205/304.
 */
export type RespondFn<TSchema extends SchemaNode> = TSchema extends EmptySchema
  ? (options?: ResponseOptions) => HandlerResponse
  : (data: InferSchema<TSchema>, options?: ResponseOptions) => HandlerResponse;

export type RespondMap<TResponses extends ResponsesConfig> = {
  [K in keyof TResponses & number]: RespondFn<TResponses[K]['schema']>;
};

/**
 * Resolve the shape of `ctx.params`, `ctx.query`, or `ctx.headers` from the
 * user's request declaration. Accepts either an inline shape
 * `{ id: t.string() }` or a named `ModelSchema`.
 */
export type InferRequestPart<T> = T extends ModelSchema<infer _Shape, infer Output>
  ? Output
  : T extends Record<string, SchemaNode>
    ? InferShape<T>
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

/** Resolve `ctx.body` from the declared `request.body` schema. */
export type InferBody<T> = T extends SchemaNode<infer U> ? U : undefined;

// ---------------------------------------------------------------------------
// HandlerContext
// ---------------------------------------------------------------------------

export interface HandlerContext<
  TParams,
  TQuery,
  TBody,
  THeaders,
  TResponses extends ResponsesConfig,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TBeforeState = {},
> {
  params: InferRequestPart<TParams>;
  query: InferRequestPart<TQuery>;
  body: InferBody<TBody>;
  headers: InferRequestPart<THeaders>;
  services: ServiceContainer;
  respond: RespondMap<TResponses>;
  /**
   * State produced by the endpoint's `beforeHandler`, if any. Readonly
   * from the handler's perspective: the beforeHandler sets it once and
   * the handler reads it. If no beforeHandler is declared, this is `{}`.
   */
  readonly state: Readonly<TBeforeState>;
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/**
 * Build the runtime `ctx.respond` object from a declared responses config.
 *
 * Each function validates its argument against the response schema before
 * wrapping it in `{ status, body }`. If validation fails, it throws a
 * `ValidationException` so the bug surfaces immediately instead of silently
 * sending malformed data.
 *
 * The runtime object is used by the test runner (Phase 5) and any HTTP
 * framework adapter that invokes the handler.
 */
export function buildRespondMap(
  responses: ResponsesConfig,
): Record<number, (data: unknown) => HandlerResponse> {
  const map: Record<number, (data: unknown) => HandlerResponse> = {};
  for (const [statusStr, config] of Object.entries(responses)) {
    const status = Number(statusStr);
    if (isEmptySchema(config.schema)) {
      map[status] = (options?: ResponseOptions): HandlerResponse => ({
        status,
        body: undefined,
        headers: options?.headers,
      });
      continue;
    }
    map[status] = (data: unknown, options?: ResponseOptions): HandlerResponse => {
      const validated = config.schema.parse(data);
      return { status, body: validated, headers: options?.headers };
    };
  }
  return map;
}
