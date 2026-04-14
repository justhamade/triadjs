/**
 * Router — the top-level container for endpoints and channels, grouped
 * optionally by DDD bounded contexts.
 *
 * ```ts
 * const router = createRouter({
 *   title: 'Petstore API',
 *   version: '1.0.0',
 * });
 *
 * router.add(createPet, getPet, listPets);
 *
 * // Or grouped by bounded context:
 * router.context('Adoption', {
 *   description: 'Manages the pet adoption lifecycle',
 *   models: [Pet, AdoptionRequest, ApiError],
 * }, (ctx) => {
 *   ctx.add(createPet, adoptPet);
 * });
 *
 * // Bounded contexts can hold both HTTP endpoints and WebSocket channels:
 * router.context('Chat', {
 *   description: 'Real-time messaging',
 *   models: [ChatMessage],
 * }, (ctx) => {
 *   ctx.add(getRoomHistory);  // HTTP endpoint
 *   ctx.add(chatRoom);        // WebSocket channel
 * });
 * ```
 *
 * Bounded contexts group routes for Gherkin output (one `.feature` file
 * per context) and let `triad validate` check that endpoints only
 * reference models declared in their context's ubiquitous language.
 */

import type { SchemaNode } from './schema/types.js';
import type { Endpoint } from './endpoint.js';
import { type Channel, isChannel } from './channel.js';

/**
 * Process-global brand used to identify `Router` instances even when the
 * `@triadjs/core` module has been loaded twice (e.g. the CLI uses jiti to
 * import the user's router file, which may resolve `@triadjs/core` through
 * Node's resolver, while the calling code uses a different copy via a
 * bundler or test-runner alias). `Symbol.for` makes this work across
 * duplicate module graphs.
 */
const ROUTER_BRAND: unique symbol = Symbol.for('@triadjs/core/Router') as never;

// ---------------------------------------------------------------------------
// Router configuration
// ---------------------------------------------------------------------------

export interface ServerConfig {
  url: string;
  description?: string;
}

export interface RouterConfig {
  title: string;
  version: string;
  description?: string;
  servers?: readonly ServerConfig[];
}

// ---------------------------------------------------------------------------
// Bounded context
// ---------------------------------------------------------------------------

export interface BoundedContextConfig {
  description?: string;
  /** Models that form this context's ubiquitous language. */
  models?: readonly SchemaNode[];
}

export interface BoundedContext {
  name: string;
  description?: string;
  models: SchemaNode[];
  endpoints: Endpoint[];
  channels: Channel[];
}

/**
 * Anything that can be added to a router or bounded context. Today that
 * is either an HTTP endpoint or a WebSocket channel. The router
 * dispatches on `isChannel()` to route each item to the right bucket.
 */
export type RoutableItem = Endpoint | Channel;

export interface ContextBuilder {
  add(...items: RoutableItem[]): ContextBuilder;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class Router {
  /** Brand used by `Router.isRouter()` to survive duplicate module instances. */
  readonly [ROUTER_BRAND] = true;

  readonly config: RouterConfig;
  private readonly _rootEndpoints: Endpoint[] = [];
  private readonly _rootChannels: Channel[] = [];
  private readonly _contexts: BoundedContext[] = [];

  constructor(config: RouterConfig) {
    this.config = config;
  }

  /**
   * Identity check that works across duplicate `@triadjs/core` module graphs.
   * Use this instead of `instanceof Router` when the router may have been
   * constructed by a different copy of `@triadjs/core` (e.g. one loaded via
   * `jiti` and another via a bundler alias).
   */
  static isRouter(value: unknown): value is Router {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[ROUTER_BRAND] === true
    );
  }

  /**
   * Register endpoints and/or channels on the root (no bounded context).
   * Dispatches each item to the endpoint or channel bucket based on a
   * structural brand check, so the ordering in a single `add(...)` call
   * doesn't matter and mixed calls are fine:
   *
   * ```ts
   * router.add(createPet, chatRoom, getPet);
   * ```
   */
  add(...items: RoutableItem[]): this {
    for (const item of items) {
      if (isChannel(item)) {
        this._rootChannels.push(item);
      } else {
        this._rootEndpoints.push(item);
      }
    }
    return this;
  }

  /**
   * Register endpoints and/or channels inside a named bounded context.
   * The `builder` callback is invoked synchronously with a tiny
   * `ContextBuilder` that collects items for this context only.
   */
  context(
    name: string,
    config: BoundedContextConfig,
    builder: (ctx: ContextBuilder) => void,
  ): this {
    const contextEndpoints: Endpoint[] = [];
    const contextChannels: Channel[] = [];
    const ctxBuilder: ContextBuilder = {
      add(...items: RoutableItem[]) {
        for (const item of items) {
          if (isChannel(item)) {
            contextChannels.push(item);
          } else {
            contextEndpoints.push(item);
          }
        }
        return ctxBuilder;
      },
    };
    builder(ctxBuilder);

    this._contexts.push({
      name,
      description: config.description,
      models: config.models ? [...config.models] : [],
      endpoints: contextEndpoints,
      channels: contextChannels,
    });
    return this;
  }

  /** Endpoints registered directly on the router (outside any context). */
  get rootEndpoints(): readonly Endpoint[] {
    return this._rootEndpoints;
  }

  /** Channels registered directly on the router (outside any context). */
  get rootChannels(): readonly Channel[] {
    return this._rootChannels;
  }

  /** All bounded contexts declared on this router. */
  get contexts(): readonly BoundedContext[] {
    return this._contexts;
  }

  /**
   * Every endpoint in the router, flattened across the root list and
   * every bounded context. Ordering: root endpoints first, then each
   * context's endpoints in the order the contexts were declared.
   */
  allEndpoints(): Endpoint[] {
    const out: Endpoint[] = [...this._rootEndpoints];
    for (const ctx of this._contexts) {
      out.push(...ctx.endpoints);
    }
    return out;
  }

  /**
   * Every channel in the router, flattened across root + contexts in
   * the same stable order as `allEndpoints()`.
   */
  allChannels(): Channel[] {
    const out: Channel[] = [...this._rootChannels];
    for (const ctx of this._contexts) {
      out.push(...ctx.channels);
    }
    return out;
  }

  /** Find an endpoint by its `name` across root + all contexts. */
  findEndpoint(name: string): Endpoint | undefined {
    return this.allEndpoints().find((e) => e.name === name);
  }

  /** Find a channel by its `name` across root + all contexts. */
  findChannel(name: string): Channel | undefined {
    return this.allChannels().find((c) => c.name === name);
  }

  /**
   * Given an endpoint or channel, return the bounded context it belongs
   * to (if any). Useful for `triad validate` and codegen tools that
   * need to know a route's context ownership.
   */
  contextOf(route: RoutableItem): BoundedContext | undefined {
    if (isChannel(route)) {
      return this._contexts.find((c) => c.channels.includes(route));
    }
    return this._contexts.find((c) => c.endpoints.includes(route));
  }
}

/** Create a new router. */
export function createRouter(config: RouterConfig): Router {
  return new Router(config);
}
