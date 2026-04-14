/**
 * Generate TanStack Query hook source from a Triad endpoint.
 *
 * The emitter is deliberately string-based: the output is a small,
 * readable `.ts` file that a user could own/edit if they wanted. No
 * TypeScript AST, no dependency on `@tanstack/react-query` at generate
 * time — the generated code references it by import only.
 */

import {
  type Endpoint,
  type ModelShape,
  type SchemaNode,
  type ResponsesConfig,
} from '@triadjs/core';
import { TypeEmitter } from './schema-to-ts.js';
import {
  extractResource,
  flatKeyFor,
  lowerFirst,
  toPascal,
  type ResourceInfo,
} from './query-keys.js';

export interface EndpointHook {
  /** Hook function name (e.g. `useBook`, `useCreateBook`). */
  name: string;
  /** Complete TypeScript source for the exported hook. */
  source: string;
  /** Type references used by the hook (must exist in types.ts). */
  typeRefs: Set<string>;
}

/**
 * Shape of an endpoint's payload surface: the named TS types derived
 * from its request + response schemas.
 */
interface EndpointShape {
  paramsType?: string;
  queryType?: string;
  headersType?: string;
  bodyType?: string;
  successType: string;
  successStatus: number;
  hasParams: boolean;
  hasQuery: boolean;
  hasBody: boolean;
  hasHeaders: boolean;
}

/**
 * Walk an endpoint and register all of its named parameter/body/response
 * types with the shared `TypeEmitter`, returning the resolved type-name
 * references the hook will need.
 */
export function collectEndpointShape(
  endpoint: Endpoint,
  emitter: TypeEmitter,
): EndpointShape {
  const shape: EndpointShape = {
    successType: 'void',
    successStatus: 200,
    hasParams: false,
    hasQuery: false,
    hasBody: false,
    hasHeaders: false,
  };

  if (endpoint.request.params !== undefined) {
    const name = `${toPascal(endpoint.name)}Params`;
    emitter.emitNamedFromShape(
      name,
      endpoint.request.params.shape as ModelShape,
      `Path parameters for \`${endpoint.method} ${endpoint.path}\`.`,
    );
    shape.paramsType = name;
    shape.hasParams = true;
  }

  if (endpoint.request.query !== undefined) {
    const name = `${toPascal(endpoint.name)}Query`;
    emitter.emitNamedFromShape(
      name,
      endpoint.request.query.shape as ModelShape,
      `Query parameters for \`${endpoint.method} ${endpoint.path}\`.`,
    );
    shape.queryType = name;
    shape.hasQuery = true;
  }

  if (endpoint.request.headers !== undefined) {
    const name = `${toPascal(endpoint.name)}Headers`;
    emitter.emitNamedFromShape(
      name,
      endpoint.request.headers.shape as ModelShape,
      `Header parameters for \`${endpoint.method} ${endpoint.path}\`.`,
    );
    shape.headersType = name;
    shape.hasHeaders = true;
  }

  if (endpoint.request.body !== undefined) {
    shape.bodyType = emitter.emitType(endpoint.request.body);
    shape.hasBody = true;
  }

  const success = pickSuccessResponse(endpoint.responses);
  if (success !== undefined) {
    shape.successStatus = success.status;
    shape.successType = success.schema.kind === 'empty'
      ? 'void'
      : emitter.emitType(success.schema);
  }

  // Walk every error response too so named error envelopes (e.g.
  // `HttpError`) land in `types.ts` even though they are not the hook's
  // success type.
  for (const [statusStr, cfg] of Object.entries(endpoint.responses)) {
    const status = Number(statusStr);
    if (status >= 200 && status < 300) continue;
    if (cfg.schema.kind === 'empty') continue;
    emitter.emitType(cfg.schema);
  }

  return shape;
}

/**
 * Pick the "success" response for a hook — the lowest 2xx status. If
 * none is declared (unusual), fall back to the lowest declared status.
 */
function pickSuccessResponse(
  responses: ResponsesConfig,
): { status: number; schema: SchemaNode } | undefined {
  const statuses = Object.keys(responses)
    .map((s) => Number(s))
    .sort((a, b) => a - b);
  const twoXx = statuses.find((s) => s >= 200 && s < 300);
  const chosen = twoXx ?? statuses[0];
  if (chosen === undefined) return undefined;
  return { status: chosen, schema: responses[chosen]!.schema };
}

/**
 * Derive the hook name from the endpoint. GET-by-id endpoints named
 * like `getBook` become `useBook`; everything else prepends `use`.
 */
export function hookNameFor(endpoint: Endpoint): string {
  const base = toPascal(endpoint.name);
  if (endpoint.method === 'GET' && /^Get[A-Z]/.test(base)) {
    return `use${base.slice(3)}`;
  }
  return `use${base}`;
}

/**
 * Render a URL path expression for the generated hook. Replaces each
 * `:param` with `${params.param}`.
 */
export function renderPathExpression(endpointPath: string): string {
  const segments = endpointPath.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      out.push(`\${params.${segment.slice(1)}}`);
    } else {
      out.push(segment);
    }
  }
  return `\`${out.join('/')}\``;
}

// ---------------------------------------------------------------------------
// Hook emission
// ---------------------------------------------------------------------------

export interface HookRenderContext {
  /** Resource the endpoint belongs to (for invalidation), if any. */
  resource?: ResourceInfo;
  /** All resources touched by the same bounded context (for cross-resource invalidation). */
  availableResources: Map<string, ResourceInfo>;
}

export function renderHook(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
): EndpointHook {
  const name = hookNameFor(endpoint);
  const typeRefs = new Set<string>();
  collectRefs(shape.paramsType, typeRefs);
  collectRefs(shape.queryType, typeRefs);
  collectRefs(shape.headersType, typeRefs);
  collectRefs(shape.bodyType, typeRefs);
  collectRefs(shape.successType, typeRefs);

  if (endpoint.method === 'GET') {
    return {
      name,
      source: renderQueryHook(endpoint, shape, context, name),
      typeRefs,
    };
  }
  return {
    name,
    source: renderMutationHook(endpoint, shape, context, name),
    typeRefs,
  };
}

function renderQueryHook(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
  hookName: string,
): string {
  const success = shape.successType;
  const pathExpr = renderPathExpression(endpoint.path);
  const resource = context.resource;

  // Distinguish "detail" (has path params) vs "list" (no path params).
  const isDetail = shape.hasParams;

  const args: string[] = [];
  if (shape.hasParams && shape.paramsType !== undefined) {
    args.push(`params: ${shape.paramsType}`);
  }
  if (shape.hasQuery && shape.queryType !== undefined) {
    args.push(`query: ${shape.queryType}`);
  }
  args.push(
    `options?: Omit<UseQueryOptions<${success}, HttpError>, 'queryKey' | 'queryFn'>`,
  );

  const queryKey = deriveQueryKey(resource, isDetail, shape, endpoint);
  const fetchOpts: string[] = [];
  if (shape.hasQuery) fetchOpts.push('query');
  const fetchOptsExpr =
    fetchOpts.length > 0 ? `, { ${fetchOpts.join(', ')} }` : '';

  return (
    `export function ${hookName}(${args.join(', ')}): UseQueryResult<${success}, HttpError> {\n` +
    `  return useQuery({\n` +
    `    queryKey: ${queryKey},\n` +
    `    queryFn: () => client.get<${success}>(${pathExpr}${fetchOptsExpr}),\n` +
    `    ...options,\n` +
    `  });\n` +
    `}`
  );
}

function renderMutationHook(
  endpoint: Endpoint,
  shape: EndpointShape,
  context: HookRenderContext,
  hookName: string,
): string {
  const success = shape.successType;
  const pathExpr = renderPathExpression(endpoint.path);
  const resource = context.resource;

  // The mutation "variables" type: a composite of what the caller must
  // pass at mutate time. We use an object so callers have a stable
  // argument shape even as the endpoint evolves.
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
  const destructure = varFields.length === 0 ? '' : `(vars) => `;
  // eslint-disable-next-line prefer-const
  let bodyUse = '';
  const fetchParts: string[] = [];
  if (shape.hasBody) fetchParts.push('body: vars.body');
  if (shape.hasQuery) fetchParts.push('query: vars.query');
  const fetchOptsExpr =
    fetchParts.length > 0 ? `, { ${fetchParts.join(', ')} }` : '';
  const pathExprInMutation = shape.hasParams
    ? renderPathExpression(endpoint.path).replace(/\$\{params\./g, '${vars.params.')
    : pathExpr;

  const mutationFn =
    varFields.length === 0
      ? `() => client.${method}<${success}>(${pathExprInMutation})`
      : `${destructure}client.${method}<${success}>(${pathExprInMutation}${fetchOptsExpr})`;

  const invalidations = renderInvalidations(resource, endpoint, shape);

  void bodyUse;

  const lines: string[] = [];
  lines.push(
    `export function ${hookName}(options?: Omit<UseMutationOptions<${success}, HttpError, ${variablesType}>, 'mutationFn'>): UseMutationResult<${success}, HttpError, ${variablesType}> {`,
  );
  lines.push(`  const qc = useQueryClient();`);
  lines.push(`  return useMutation({`);
  lines.push(`    mutationFn: ${mutationFn},`);
  lines.push(`    onSuccess: (data, variables, context) => {`);
  for (const inv of invalidations) {
    lines.push(`      ${inv}`);
  }
  lines.push(`      options?.onSuccess?.(data, variables, context);`);
  lines.push(`    },`);
  lines.push(`    ...options,`);
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
    const flat = flatKeyFor(endpoint);
    return flat.name;
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

function collectRefs(type: string | undefined, into: Set<string>): void {
  if (type === undefined) return;
  const matches = type.match(/[A-Z][A-Za-z0-9_]*/g);
  if (matches === null) return;
  for (const m of matches) into.add(m);
}

export { lowerFirst };
