/**
 * OpenAPI 3.1 document generator.
 *
 * Walks a Triad `Router` and produces a complete OpenAPI 3.1 document:
 *
 *   - Endpoints → `paths[<path>][<method>]` operations
 *   - Named models → `components/schemas` with `$ref`
 *   - Inline request shapes → expanded into `parameters[]` (path/query/header)
 *   - Request bodies → `requestBody.content.application/json.schema`
 *   - Responses → `responses[<status>]` with validated schemas
 *   - Bounded contexts → top-level `tags[]` with descriptions; endpoints in
 *     a context are auto-tagged with the context name
 *
 * The generator is pure: it takes a Router and returns a plain JS object.
 * Serialization (YAML/JSON) lives in a sibling module.
 */

import {
  type Router,
  type Endpoint,
  type HttpMethod,
  type OpenAPISchema,
  type OpenAPIContext,
  type ResponsesConfig,
  type ModelShape,
  type SchemaNode,
  createOpenAPIContext,
  isEmptySchema,
  hasFileFields,
} from '@triadjs/core';

// ---------------------------------------------------------------------------
// OpenAPI 3.1 document types (the subset Triad produces)
// ---------------------------------------------------------------------------

export interface OpenAPIDocument {
  openapi: '3.1.0';
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  tags?: OpenAPITag[];
  paths: Record<string, PathItem>;
  components: {
    schemas: Record<string, OpenAPISchema>;
  };
}

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
}

export interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema: OpenAPISchema;
}

export interface RequestBody {
  description?: string;
  required: boolean;
  content: Record<string, MediaType>;
}

export interface Response {
  description: string;
  content?: Record<string, MediaType>;
}

export interface MediaType {
  schema: OpenAPISchema;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** If true, include endpoints marked `tags: []` (default: true). */
  includeUntagged?: boolean;
}

/**
 * Generate an OpenAPI 3.1 document from a Triad router.
 */
export function generateOpenAPI(
  router: Router,
  _options: GenerateOptions = {},
): OpenAPIDocument {
  const ctx = createOpenAPIContext();
  const paths: Record<string, PathItem> = {};
  const tags = collectTags(router);

  for (const endpoint of router.allEndpoints()) {
    const path = convertPath(endpoint.path);
    const method = methodKey(endpoint.method);
    const pathItem = (paths[path] ??= {});
    const operation = buildOperation(endpoint, router, ctx);
    pathItem[method] = operation;

    // Ensure any endpoint tags are present in the top-level tag list.
    for (const tag of operation.tags ?? []) {
      if (!tags.find((t) => t.name === tag)) {
        tags.push({ name: tag });
      }
    }
  }

  const doc: OpenAPIDocument = {
    openapi: '3.1.0',
    info: buildInfo(router),
    paths,
    components: {
      schemas: Object.fromEntries(ctx.components),
    },
  };

  if (router.config.servers && router.config.servers.length > 0) {
    doc.servers = router.config.servers.map((s) => ({
      url: s.url,
      description: s.description,
    }));
  }

  if (tags.length > 0) {
    doc.tags = tags;
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInfo(router: Router): OpenAPIInfo {
  const info: OpenAPIInfo = {
    title: router.config.title,
    version: router.config.version,
  };
  if (router.config.description !== undefined) {
    info.description = router.config.description;
  }
  return info;
}

/** Bounded contexts provide documented tags with descriptions. */
function collectTags(router: Router): OpenAPITag[] {
  const tags: OpenAPITag[] = [];
  for (const context of router.contexts) {
    const tag: OpenAPITag = { name: context.name };
    if (context.description !== undefined) {
      tag.description = context.description;
    }
    tags.push(tag);
  }
  return tags;
}

/** Express-style `:id` → OpenAPI `{id}`. */
export function convertPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function methodKey(method: HttpMethod): Lowercase<HttpMethod> {
  return method.toLowerCase() as Lowercase<HttpMethod>;
}

function buildOperation(
  endpoint: Endpoint,
  router: Router,
  ctx: OpenAPIContext,
): Operation {
  const tags = [...endpoint.tags];

  // Auto-tag endpoints inside a bounded context with the context name.
  const context = router.contextOf(endpoint);
  if (context && !tags.includes(context.name)) {
    tags.push(context.name);
  }

  const op: Operation = {
    operationId: endpoint.name,
    summary: endpoint.summary,
    responses: buildResponses(endpoint.responses, ctx),
  };

  if (endpoint.description !== undefined) {
    op.description = endpoint.description;
  }
  if (tags.length > 0) {
    op.tags = tags;
  }

  const parameters = buildParameters(endpoint, ctx);
  if (parameters.length > 0) {
    op.parameters = parameters;
  }

  if (endpoint.request.body !== undefined) {
    op.requestBody = buildRequestBody(endpoint.request.body, ctx);
  }

  return op;
}

function buildParameters(endpoint: Endpoint, ctx: OpenAPIContext): Parameter[] {
  const params: Parameter[] = [];

  // Path parameters — always required.
  if (endpoint.request.params) {
    const shape = endpoint.request.params.shape as ModelShape;
    for (const [name, schema] of Object.entries(shape)) {
      params.push(buildParameter(name, 'path', schema, ctx, { alwaysRequired: true }));
    }
  }

  if (endpoint.request.query) {
    const shape = endpoint.request.query.shape as ModelShape;
    for (const [name, schema] of Object.entries(shape)) {
      params.push(buildParameter(name, 'query', schema, ctx));
    }
  }

  if (endpoint.request.headers) {
    const shape = endpoint.request.headers.shape as ModelShape;
    for (const [name, schema] of Object.entries(shape)) {
      params.push(buildParameter(name, 'header', schema, ctx));
    }
  }

  return params;
}

function buildParameter(
  name: string,
  location: Parameter['in'],
  schema: SchemaNode,
  ctx: OpenAPIContext,
  opts: { alwaysRequired?: boolean } = {},
): Parameter {
  const required =
    opts.alwaysRequired ??
    (!schema.isOptional && schema.metadata.default === undefined);

  const param: Parameter = {
    name,
    in: location,
    schema: schema.toOpenAPI(ctx),
  };
  if (required) param.required = true;
  if (schema.metadata.description !== undefined) {
    param.description = schema.metadata.description;
  }
  if (schema.metadata.deprecated) {
    param.deprecated = true;
  }
  return param;
}

function buildRequestBody(
  schema: SchemaNode,
  ctx: OpenAPIContext,
): RequestBody {
  // Any body containing one or more `t.file()` fields forces the
  // request body's content-type to `multipart/form-data`. The OpenAPI
  // spec allows no other representation for binary file uploads.
  const contentType = hasFileFields(schema)
    ? 'multipart/form-data'
    : 'application/json';
  const emitted = schema.toOpenAPI(ctx);
  // After emission, walk components and the returned schema to strip
  // the internal `__file` marker we use to track file fields in-memory.
  stripFileMarkers(emitted);
  for (const component of ctx.components.values()) {
    stripFileMarkers(component);
  }
  return {
    required: true,
    content: {
      [contentType]: {
        schema: emitted,
      },
    },
  };
}

/** Recursively remove the internal `__file` marker from an emitted OpenAPI schema. */
function stripFileMarkers(schema: OpenAPISchema | undefined): void {
  if (!schema || typeof schema !== 'object') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = schema as any;
  if ('__file' in any) {
    delete any.__file;
  }
  if (any.properties) {
    for (const child of Object.values(any.properties)) {
      stripFileMarkers(child as OpenAPISchema);
    }
  }
  if (any.items) {
    stripFileMarkers(any.items as OpenAPISchema);
  }
  if (Array.isArray(any.prefixItems)) {
    for (const child of any.prefixItems) stripFileMarkers(child as OpenAPISchema);
  }
  if (Array.isArray(any.oneOf)) {
    for (const child of any.oneOf) stripFileMarkers(child as OpenAPISchema);
  }
  if (Array.isArray(any.anyOf)) {
    for (const child of any.anyOf) stripFileMarkers(child as OpenAPISchema);
  }
  if (Array.isArray(any.allOf)) {
    for (const child of any.allOf) stripFileMarkers(child as OpenAPISchema);
  }
  if (any.additionalProperties && typeof any.additionalProperties === 'object') {
    stripFileMarkers(any.additionalProperties as OpenAPISchema);
  }
}

function buildResponses(
  responses: ResponsesConfig,
  ctx: OpenAPIContext,
): Record<string, Response> {
  const out: Record<string, Response> = {};
  const statusCodes = Object.keys(responses)
    .map((s) => Number(s))
    .sort((a, b) => a - b);

  for (const status of statusCodes) {
    const config = responses[status]!;
    const response: Response = { description: config.description };
    // `t.empty()` responses intentionally omit `content` — per the HTTP
    // spec, 204/205/304 must not carry a message body, and OpenAPI tools
    // (client generators, mock servers) rely on the absence of `content`
    // to know not to expect one.
    if (!isEmptySchema(config.schema)) {
      response.content = {
        'application/json': {
          schema: config.schema.toOpenAPI(ctx),
        },
      };
    }
    out[String(status)] = response;
  }

  return out;
}

