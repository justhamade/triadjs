/**
 * Emit Solid Query (`@tanstack/solid-query`) hooks from a Triad endpoint.
 *
 * The emitted hooks wrap their query/mutation options in a thunk so
 * that reactive dependencies (signal accessors, props) trigger
 * re-fetches. Query inputs (`params`, `query`) are passed as accessor
 * functions `() => T` so the generated code stays reactive end-to-end.
 *
 * Reuses `collectEndpointShape`, `renderPathExpression`, and
 * `hookNameFor` from `@triad/tanstack-query` because the type surface
 * for every endpoint is identical — only the runtime API differs.
 */

import type { Endpoint } from '@triad/core';
import {
  TypeEmitter,
  collectEndpointShape,
  flatKeyFor,
  extractResource,
  hookNameFor,
  renderPathExpression,
  type ResourceInfo,
} from '@triad/tanstack-query';

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

export function renderSolidHook(
  endpoint: Endpoint,
  emitter: TypeEmitter,
  context: HookRenderContext,
): EndpointHook {
  const shape = collectEndpointShape(endpoint, emitter) as EndpointShape;
  const name = hookNameFor(endpoint);
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
  hookName: string,
): string {
  const success = shape.successType;
  const resource = context.resource;
  const isDetail = shape.hasParams;

  // Accessor-function args for reactive inputs.
  const args: string[] = [];
  if (shape.hasParams && shape.paramsType !== undefined) {
    args.push(`params: () => ${shape.paramsType}`);
  }
  if (shape.hasQuery && shape.queryType !== undefined) {
    args.push(`query: () => ${shape.queryType}`);
  }
  args.push(
    `options?: Omit<SolidQueryOptions<${success}, HttpError>, 'queryKey' | 'queryFn'>`,
  );

  const pathExpr = renderReactivePath(endpoint.path, 'params()');
  const queryKey = deriveQueryKey(resource, isDetail, shape, endpoint, {
    paramsExpr: 'params()',
    queryExpr: 'query()',
  });
  const fetchParts: string[] = [];
  if (shape.hasQuery) fetchParts.push('query: query()');
  const fetchOptsExpr = fetchParts.length > 0 ? `, { ${fetchParts.join(', ')} }` : '';

  return (
    `export function ${hookName}(${args.join(', ')}) {\n` +
    `  return createQuery(() => ({\n` +
    `    queryKey: ${queryKey},\n` +
    `    queryFn: () => client.get<${success}>(${pathExpr}${fetchOptsExpr}),\n` +
    `    ...(options ?? {}),\n` +
    `  }));\n` +
    `}`
  );
}

function renderMutation(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
  hookName: string,
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
  const fetchOptsExpr = fetchParts.length > 0 ? `, { ${fetchParts.join(', ')} }` : '';

  const mutationFn =
    varFields.length === 0
      ? `() => client.${method}<${success}>(${pathExprInMutation})`
      : `(vars: ${variablesType}) => client.${method}<${success}>(${pathExprInMutation}${fetchOptsExpr})`;

  const invalidations = renderInvalidations(resource, endpoint, shape);

  const lines: string[] = [];
  lines.push(
    `export function ${hookName}(options?: Omit<SolidMutationOptions<${success}, HttpError, ${variablesType}>, 'mutationFn'>) {`,
  );
  lines.push(`  const qc = useQueryClient();`);
  lines.push(`  return createMutation(() => ({`);
  lines.push(`    mutationFn: ${mutationFn},`);
  lines.push(`    onSuccess: (data: ${success}, variables: ${variablesType}, context: unknown) => {`);
  for (const inv of invalidations) {
    lines.push(`      ${inv}`);
  }
  lines.push(`      options?.onSuccess?.(data, variables, context);`);
  lines.push(`    },`);
  lines.push(`    ...(options ?? {}),`);
  lines.push(`  }));`);
  lines.push(`}`);
  return lines.join('\n');
}

function deriveQueryKey(
  resource: ResourceInfo | undefined,
  isDetail: boolean,
  shape: EndpointShape,
  endpoint: Endpoint,
  exprs: { paramsExpr: string; queryExpr: string },
): string {
  if (resource === undefined) {
    return flatKeyFor(endpoint).name;
  }
  if (isDetail && resource.idParam !== undefined) {
    return `${resource.factoryName}.detail(${exprs.paramsExpr}.${resource.idParam})`;
  }
  if (shape.hasQuery) {
    return `${resource.factoryName}.list(${exprs.queryExpr})`;
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
  } else if (method === 'PATCH' || method === 'PUT') {
    if (resource.idParam !== undefined && shape.hasParams) {
      out.push(
        `qc.invalidateQueries({ queryKey: ${factory}.detail(variables.params.${resource.idParam}) });`,
      );
    }
    out.push(`qc.invalidateQueries({ queryKey: ${factory}.lists() });`);
  } else if (method === 'DELETE') {
    if (resource.idParam !== undefined && shape.hasParams) {
      out.push(
        `qc.invalidateQueries({ queryKey: ${factory}.detail(variables.params.${resource.idParam}) });`,
      );
    }
    out.push(`qc.invalidateQueries({ queryKey: ${factory}.lists() });`);
  }
  return out;
}

/**
 * Replace `:param` segments with `${accessor.param}` for use inside a
 * template literal evaluated at query time (where `accessor` is
 * `params()` in Solid's reactive model).
 */
function renderReactivePath(endpointPath: string, accessor: string): string {
  const segments = endpointPath.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      out.push(`\${${accessor}.${segment.slice(1)}}`);
    } else {
      out.push(segment);
    }
  }
  return `\`${out.join('/')}\``;
}

function collectRefs(type: string | undefined, into: Set<string>): void {
  if (type === undefined) return;
  const matches = type.match(/[A-Z][A-Za-z0-9_]*/g);
  if (matches === null) return;
  for (const m of matches) into.add(m);
}

export { extractResource, flatKeyFor, hookNameFor };
