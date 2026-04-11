/**
 * `beforeHandler` — the endpoint's request-lifecycle hook.
 *
 * An endpoint's `beforeHandler` runs BEFORE request schema validation.
 * It receives the raw incoming request (pre-coercion, pre-validation)
 * and returns one of two things:
 *
 *   1. `{ ok: true, state }` — success. The `state` value is threaded
 *      into the main handler's `ctx.state` (readonly). The main
 *      handler's `TBeforeState` generic is inferred from this return.
 *
 *   2. `{ ok: false, response }` — short-circuit. The main handler is
 *      NEVER called; the `response` is dispatched directly. The
 *      response body is still validated against the endpoint's
 *      declared response schema for its status code, so a buggy
 *      beforeHandler cannot leak malformed data.
 *
 * ## Why singular, not an array
 *
 * Triad deliberately exposes a single `beforeHandler` per endpoint —
 * NOT a middleware chain. The reasoning:
 *
 *   - One declarative hook keeps the request lifecycle legible at a
 *     glance. You never have to walk a stack to find where auth lives.
 *   - Users who need composition write plain functions and call them
 *     in their own `beforeHandler`:
 *       `beforeHandler: async (ctx) => {
 *         const a = await requireAuth(ctx);
 *         if (!a.ok) return a;
 *         const b = await requireFeatureFlag(ctx, a.state);
 *         if (!b.ok) return b;
 *         return { ok: true, state: { ...a.state, ...b.state } };
 *       }`
 *   - Middleware stacks make type inference much harder (each middleware
 *     augments the context type) and the `TBeforeState` inference
 *     approach used here only works with a single function return type.
 *
 * ## Why `ctx.state` is readonly
 *
 * The beforeHandler sets `state` once; the handler only reads it. Making
 * it `Readonly<TState>` at the handler-context level prevents subtle
 * bugs where a handler mutates a value the beforeHandler thought it
 * owned.
 *
 * ## Why no `afterHandler`
 *
 * Out of scope for Phase 10.3. Response shaping and outgoing mutation
 * concerns are satisfied today by the schema-validation pipeline in
 * `ctx.respond`. If a genuine need surfaces, a future phase can add
 * it — there's no forward-compat hazard in doing nothing now.
 */

import type { ResponsesConfig, HandlerResponse, RespondMap } from './context.js';

// ---------------------------------------------------------------------------
// BeforeHandler context — the raw, pre-validation request view
// ---------------------------------------------------------------------------

/**
 * The context a `beforeHandler` receives. Everything here is the
 * RAW request — headers/query/params have not been coerced, decoded,
 * or validated against the endpoint's declared schemas. This is
 * intentional: auth code needs to reject missing/malformed inputs
 * BEFORE request-schema validation 400s them.
 *
 * The beforeHandler has access to `services` and `respond` so it can
 * construct short-circuit responses using the same type-safe response
 * map that the main handler uses — enforcing that a beforeHandler
 * cannot respond with an undeclared status code.
 */
export interface BeforeHandlerContext<TResponses extends ResponsesConfig> {
  readonly rawHeaders: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawQuery: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawParams: Readonly<Record<string, string>>;
  readonly rawCookies: Readonly<Record<string, string | undefined>>;
  readonly services: import('./context.js').ServiceContainer;
  readonly respond: RespondMap<TResponses>;
}

// ---------------------------------------------------------------------------
// BeforeHandler result — success or short-circuit
// ---------------------------------------------------------------------------

/** Short-circuit: the beforeHandler returned a fully-formed response. */
export type BeforeHandlerShortCircuit = {
  readonly ok: false;
  readonly response: HandlerResponse;
};

/** Success: the beforeHandler produced typed state for the handler. */
export type BeforeHandlerSuccess<TState> = {
  readonly ok: true;
  readonly state: TState;
};

export type BeforeHandlerResult<TState> =
  | BeforeHandlerSuccess<TState>
  | BeforeHandlerShortCircuit;

/**
 * The `beforeHandler` function type. The generic `TState` is what the
 * hook provides to the main handler; `TResponses` is the endpoint's
 * declared response config.
 */
export type BeforeHandler<TState, TResponses extends ResponsesConfig> = (
  ctx: BeforeHandlerContext<TResponses>,
) => Promise<BeforeHandlerResult<TState>>;

// ---------------------------------------------------------------------------
// Runtime invocation
// ---------------------------------------------------------------------------

/**
 * Invoke an endpoint's `beforeHandler` if present, or return the empty
 * success state. Adapters and the test runner call this before
 * building the main handler's context.
 */
export async function invokeBeforeHandler(
  beforeHandler:
    | BeforeHandler<unknown, ResponsesConfig>
    | undefined,
  ctx: BeforeHandlerContext<ResponsesConfig>,
): Promise<BeforeHandlerResult<unknown>> {
  if (!beforeHandler) {
    return { ok: true, state: {} };
  }
  return beforeHandler(ctx);
}
