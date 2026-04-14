/**
 * Walk a router and collect every `ModelSchema` reachable from its
 * endpoints' request and response schemas. Used by the assertion executor
 * to resolve `response body matches Pet` assertions by name.
 *
 * Uses the `kind` discriminator rather than `instanceof` checks so the
 * walker keeps working when the router was loaded through a different
 * copy of `@triadjs/core` than the test-runner itself (e.g. via jiti in the
 * CLI). `instanceof` breaks across duplicate module graphs; string
 * comparison does not.
 */

import type { Router, SchemaNode, ModelSchema, ModelShape } from '@triadjs/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelRegistry = Map<string, ModelSchema<any>>;

// Structural view of the schema subclasses we need to walk. We intentionally
// do not `instanceof` against the imported classes because the router we're
// walking may be constructed by a *different* copy of `@triadjs/core`.
interface ModelLike {
  readonly kind: 'model';
  readonly name: string;
  readonly shape: ModelShape;
}
interface ArrayLike {
  readonly kind: 'array';
  readonly item: SchemaNode;
}
interface RecordLike {
  readonly kind: 'record';
  readonly valueSchema: SchemaNode;
}
interface UnionLike {
  readonly kind: 'union';
  readonly options: readonly SchemaNode[];
}
interface TupleLike {
  readonly kind: 'tuple';
  readonly items: readonly SchemaNode[];
}

export function collectModels(router: Router): ModelRegistry {
  const registry: ModelRegistry = new Map();

  const visit = (schema: SchemaNode | undefined): void => {
    if (!schema) return;

    switch (schema.kind) {
      case 'model': {
        const m = schema as unknown as ModelLike;
        if (registry.has(m.name)) return; // break cycles
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        registry.set(m.name, schema as unknown as ModelSchema<any>);
        for (const field of Object.values(m.shape)) {
          visit(field as SchemaNode);
        }
        return;
      }
      case 'array': {
        const a = schema as unknown as ArrayLike;
        visit(a.item);
        return;
      }
      case 'record': {
        const r = schema as unknown as RecordLike;
        visit(r.valueSchema);
        return;
      }
      case 'union': {
        const u = schema as unknown as UnionLike;
        for (const opt of u.options) visit(opt);
        return;
      }
      case 'tuple': {
        const t = schema as unknown as TupleLike;
        for (const item of t.items) visit(item);
        return;
      }
      // Primitives, enums, literals, values, unknown — no nested models.
    }
  };

  for (const endpoint of router.allEndpoints()) {
    visit(endpoint.request.body);
    visit(endpoint.request.params);
    visit(endpoint.request.query);
    visit(endpoint.request.headers);
    for (const response of Object.values(endpoint.responses)) {
      visit(response.schema);
    }
  }

  return registry;
}
