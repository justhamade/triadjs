/**
 * Emit Svelte Query (`@tanstack/svelte-query`) store factories from a
 * Triad endpoint.
 *
 * Svelte Query uses plain value args (no reactive wrapping) and
 * naming convention `createXxxQuery` / `createXxxMutation` to signal
 * that each call creates a new store subscription.
 */

import type { Endpoint } from '@triadjs/core';
import {
  TypeEmitter,
  collectEndpointShape,
  flatKeyFor,
  extractResource,
  renderPathExpression,
  toPascal,
  type ResourceInfo,
} from '@triadjs/tanstack-query';

export interface EndpointHook {
  name: string;
  source: string;
  typeRefs: Set<string>;
}

export interface HookRenderContext {
  resource?: ResourceInfo;
  availableResources: Map<string, ResourceInfo>;
}

interface EndpointShape {
  paramsType?: string;
  queryType?: string;
  headersType?: string;
  bodyType?: string;
  successType: string;
  hasParams: boolean;
  hasQuery: boolean;
  hasBody: boolean;
  hasHeaders: boolean;
}

/**
 * Derive a Svelte-flavoured factory name: `createXxxQuery` for GETs
 * and `createXxxMutation` for mutations. GETs whose endpoint name
 * starts with `get` drop the prefix, mirroring the hook-naming rules
 * from `@triadjs/tanstack-query`.
 */
export function svelteFactoryName(endpoint: Endpoint): string {
  const base = toPascal(endpoint.name);
  if (endpoint.method === 'GET') {
    const stem = /^Get[A-Z]/.test(base) ? base.slice(3) : base;
    return `create${stem}Query`;
  }
  return `create${base}Mutation`;
}

export function renderSvelteHook(
  endpoint: Endpoint,
  emitter: TypeEmitter,
  context: HookRenderContext,
): EndpointHook {
  const shape = collectEndpointShape(endpoint, emitter) as EndpointShape;
  const name = svelteFactoryName(endpoint);
  const typeRefs = new Set<string>();
  collectRefs(shape.paramsType, typeRefs);
  collectRefs(shape.queryType, typeRefs);
  collectRefs(shape.bodyType, typeRefs);
  collectRefs(shape.successType, typeRefs);

  const source =
    endpoint.method === 'GET'
      ? renderQuery(endpoint, shape, context, name)
      : renderMutation(endpoint, shape, context, name);
  return { name, source, typeRefs };
}

function renderQuery(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
  factoryName: string,
): string {
  const success = shape.successType;
  const resource = context.resource;
  const isDetail = shape.hasParams;

  const args: string[] = [];
  if (shape.hasParams && shape.paramsType !== undefined) {
    args.push(`params: ${shape.paramsType}`);
  }
  if (shape.hasQuery && shape.queryType !== undefined) {
    args.push(`query: ${shape.queryType}`);
  }
  args.push(
    `options?: Omit<CreateQueryOptions<${success}, HttpError>, 'queryKey' | 'queryFn'>`,
  );

  const pathExpr = renderPathExpression(endpoint.path);
  const queryKey = deriveQueryKey(resource, isDetail, shape, endpoint);
  const fetchParts: string[] = [];
  if (shape.hasQuery) fetchParts.push('query');
  const fetchOptsExpr =
    fetchParts.length > 0 ? `, { ${fetchParts.join(', ')} }` : '';

  return (
    `export function ${factoryName}(${args.join(', ')}) {\n` +
    `  return createQuery({\n` +
    `    queryKey: ${queryKey},\n` +
    `    queryFn: () => client.get<${success}>(${pathExpr}${fetchOptsExpr}),\n` +
    `    ...(options ?? {}),\n` +
    `  });\n` +
    `}`
  );
}

function renderMutation(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
  factoryName: string,
): string {
  const success = shape.successType;
  const resource = context.resource;

  const varFields: string[] = [];
  if (shape.hasParams && shape.paramsType !== undefined) {
    varFields.push(`params: ${shape.paramsType}`);
  }
  if (shape.hasBody && shape.bodyType !== undefined) {
    varFields.push(`body: ${shape.bodyType}`);
  }
  if (shape.hasQuery && shape.queryType !== undefined) {
    varFields.push(`query: ${shape.queryType}`);
  }
  const variablesType =
    varFields.length === 0 ? 'void' : `{ ${varFields.join('; ')} }`;

  const method = endpoint.method.toLowerCase();
  const pathExprInMutation = shape.hasParams
    ? renderPathExpression(endpoint.path).replace(/\$\{params\./g, '${vars.params.')
    : renderPathExpression(endpoint.path);

  const fetchParts: string[] = [];
  if (shape.hasBody) fetchParts.push('body: vars.body');
  if (shape.hasQuery) fetchParts.push('query: vars.query');
  const fetchOptsExpr =
    fetchParts.length > 0 ? `, { ${fetchParts.join(', ')} }` : '';

  const mutationFn =
    varFields.length === 0
      ? `() => client.${method}<${success}>(${pathExprInMutation})`
      : `(vars: ${variablesType}) => client.${method}<${success}>(${pathExprInMutation}${fetchOptsExpr})`;

  const invalidations = renderInvalidations(resource, endpoint, shape);

  const lines: string[] = [];
  lines.push(
    `export function ${factoryName}(options?: Omit<CreateMutationOptions<${success}, HttpError, ${variablesType}>, 'mutationFn'>) {`,
  );
  lines.push(`  const qc = useQueryClient();`);
  lines.push(`  return createMutation({`);
  lines.push(`    mutationFn: ${mutationFn},`);
  lines.push(`    onSuccess: (data: ${success}, variables: ${variablesType}, context: unknown) => {`);
  for (const inv of invalidations) {
    lines.push(`      ${inv}`);
  }
  lines.push(`      options?.onSuccess?.(data, variables, context);`);
  lines.push(`    },`);
  lines.push(`    ...(options ?? {}),`);
  lines.push(`  });`);
  lines.push(`}`);
  return lines.join('\n');
}

function deriveQueryKey(
  resource: ResourceInfo | undefined,
  isDetail: boolean,
  shape: EndpointShape,
  endpoint: Endpoint,
): string {
  if (resource === undefined) {
    return flatKeyFor(endpoint).name;
  }
  if (isDetail && resource.idParam !== undefined) {
    return `${resource.factoryName}.detail(params.${resource.idParam})`;
  }
  if (shape.hasQuery) {
    return `${resource.factoryName}.list(query)`;
  }
  return `${resource.factoryName}.lists()`;
}

function renderInvalidations(
  resource: ResourceInfo | undefined,
  endpoint: Endpoint,
  shape: EndpointShape,
): string[] {
  if (resource === undefined) return [];
  const out: string[] = [];
  const method = endpoint.method;
  const factory = resource.factoryName;
  if (method === 'POST') {
    out.push(`qc.invalidateQueries({ queryKey: ${factory}.lists() });`);
  } else if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    if (resource.idParam !== undefined && shape.hasParams) {
      out.push(
        `qc.invalidateQueries({ queryKey: ${factory}.detail(variables.params.${resource.idParam}) });`,
      );
    }
    out.push(`qc.invalidateQueries({ queryKey: ${factory}.lists() });`);
  }
  return out;
}

function collectRefs(type: string | undefined, into: Set<string>): void {
  if (type === undefined) return;
  const matches = type.match(/[A-Z][A-Za-z0-9_]*/g);
  if (matches === null) return;
  for (const m of matches) into.add(m);
}

export { extractResource, flatKeyFor };
