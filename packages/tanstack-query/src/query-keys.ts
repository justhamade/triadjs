/**
 * Query key derivation and key-factory emission.
 *
 * The default strategy groups endpoints by "resource" — the last path
 * segment that looks like a collection (plural, non-parameter). For each
 * resource we emit a tiny factory mirroring the shape TanStack Query
 * docs recommend:
 *
 * ```ts
 * export const bookKeys = {
 *   all: ['books'] as const,
 *   lists: () => [...bookKeys.all, 'list'] as const,
 *   list: (params: ListBooksParams) => [...bookKeys.lists(), params] as const,
 *   details: () => [...bookKeys.all, 'detail'] as const,
 *   detail: (id: string) => [...bookKeys.details(), id] as const,
 * };
 * ```
 *
 * Endpoints whose path cannot be parsed as a CRUD resource (e.g.
 * `/auth/login`) are handled separately in the hook generator via a
 * flat key `['auth', 'login']`.
 */

import type { Endpoint } from '@triadjs/core';

export interface ResourceInfo {
  /** Lowercase plural segment used for the `all` key (e.g. `books`). */
  resource: string;
  /** PascalCase base used for hook/type identifiers (e.g. `Book`). */
  base: string;
  /** Name of the generated key factory (e.g. `bookKeys`). */
  factoryName: string;
  /** The id parameter name for the detail path (e.g. `bookId`), if any. */
  idParam?: string;
}

const PATH_PARAM_RE = /^:/;

/**
 * Extract the "resource" from an endpoint path by finding the last
 * plural segment that is not a path parameter. Returns `undefined` if
 * no CRUD-style resource can be inferred.
 */
export function extractResource(endpointPath: string): ResourceInfo | undefined {
  const segments = endpointPath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return undefined;

  // Walk from the end: last segment that is not a :param is the
  // resource. If the last segment IS a :param, the one before it is.
  let resourceIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (!PATH_PARAM_RE.test(segment)) {
      resourceIndex = i;
      break;
    }
  }
  if (resourceIndex === -1) return undefined;

  const resource = segments[resourceIndex]!.toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/i.test(resource)) return undefined;

  // The id parameter is the :segment immediately after the resource.
  let idParam: string | undefined;
  const next = segments[resourceIndex + 1];
  if (next !== undefined && PATH_PARAM_RE.test(next)) {
    idParam = next.slice(1);
  }

  const base = toPascal(singularize(resource));
  const factoryName = `${lowerFirst(base)}Keys`;

  return idParam !== undefined
    ? { resource, base, factoryName, idParam }
    : { resource, base, factoryName };
}

/**
 * Flat "operation" key used for endpoints that don't map to a
 * CRUD-style resource (e.g. `/auth/login`).
 */
export function flatKeyFor(endpoint: Endpoint): { name: string; value: string } {
  const segments = endpoint.path.split('/').filter((s) => s.length > 0 && !PATH_PARAM_RE.test(s));
  const parts = segments.length > 0 ? segments : [endpoint.name];
  const name = `${lowerFirst(toPascal(endpoint.name))}Key`;
  const value = `[${parts.map((p) => JSON.stringify(p.toLowerCase())).join(', ')}] as const`;
  return { name, value };
}

/**
 * Group endpoints by resource for key-factory emission. Endpoints that
 * don't yield a resource are collected under the `null` bucket and
 * handled via flat keys.
 */
export function groupByResource(
  endpoints: readonly Endpoint[],
): Map<string | null, { info: ResourceInfo | undefined; endpoints: Endpoint[] }> {
  const groups = new Map<
    string | null,
    { info: ResourceInfo | undefined; endpoints: Endpoint[] }
  >();
  for (const endpoint of endpoints) {
    const info = extractResource(endpoint.path);
    const key = info?.resource ?? null;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.endpoints.push(endpoint);
    } else {
      groups.set(key, { info, endpoints: [endpoint] });
    }
  }
  return groups;
}

/**
 * Emit the key factory source for a single resource. The result is a
 * complete `export const xxxKeys = { ... };` declaration.
 */
export function emitKeyFactory(info: ResourceInfo, listParamsType: string | undefined): string {
  const { resource, factoryName, idParam } = info;
  const lines: string[] = [];
  lines.push(`export const ${factoryName} = {`);
  lines.push(`  all: [${JSON.stringify(resource)}] as const,`);
  lines.push(`  lists: () => [...${factoryName}.all, 'list'] as const,`);
  const listParamType = listParamsType ?? 'Record<string, unknown> | undefined';
  lines.push(
    `  list: (params?: ${listParamType}) => [...${factoryName}.lists(), params ?? {}] as const,`,
  );
  lines.push(`  details: () => [...${factoryName}.all, 'detail'] as const,`);
  if (idParam !== undefined) {
    lines.push(`  detail: (id: string) => [...${factoryName}.details(), id] as const,`);
  }
  lines.push('};');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Casing helpers
// ---------------------------------------------------------------------------

export function toPascal(input: string): string {
  return input
    .split(/[^A-Za-z0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export function lowerFirst(input: string): string {
  if (input.length === 0) return input;
  return input.charAt(0).toLowerCase() + input.slice(1);
}

/** Tiny singulariser — only the rules we need for the common CRUD shapes. */
export function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
