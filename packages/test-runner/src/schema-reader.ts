/**
 * Walk a Triad schema tree and extract a structured constraint descriptor.
 *
 * Dispatches on `schema.kind` and reads the constraint fields stored on
 * each SchemaNode subclass. The returned `FieldDescriptor` tree is consumed
 * by the auto-generators to produce boundary, missing-field, type-confusion,
 * and invalid-enum test scenarios.
 */

import type {
  Endpoint,
  SchemaNode,
  StringSchema,
  NumberSchema,
  EnumSchema,
  ArraySchema,
  ModelSchema,
  FileSchema,
  LiteralSchema,
  ModelShape,
} from '@triad/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FieldConstraints {
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  enumValues?: readonly string[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minSize?: number;
  maxSize?: number;
  mimeTypes?: readonly string[];
  literalValue?: string | number | boolean;
}

export interface FieldDescriptor {
  name: string;
  kind: string;
  required: boolean;
  nullable: boolean;
  constraints: FieldConstraints;
  children?: FieldDescriptor[];
}

export interface EndpointDescriptor {
  body: FieldDescriptor[] | null;
  query: FieldDescriptor[] | null;
  params: FieldDescriptor[] | null;
  headers: FieldDescriptor[] | null;
  declaredStatuses: number[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function describeEndpoint(endpoint: Endpoint): EndpointDescriptor {
  return {
    body: describeRequestPart(endpoint.request.body),
    query: describeRequestPart(endpoint.request.query),
    params: describeRequestPart(endpoint.request.params),
    headers: describeRequestPart(endpoint.request.headers),
    declaredStatuses: Object.keys(endpoint.responses).map(Number),
  };
}

export function describeSchema(name: string, schema: SchemaNode): FieldDescriptor {
  const kind = resolveKind(schema);
  const required = !schema.isOptional;
  const nullable = schema.isNullable;
  const constraints = extractConstraints(schema);
  const children = extractChildren(schema);

  return {
    name,
    kind,
    required,
    nullable,
    constraints,
    ...(children ? { children } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function describeRequestPart(schema: SchemaNode | undefined): FieldDescriptor[] | null {
  if (!schema) return null;

  if (schema.kind === 'model') {
    const model = schema as ModelSchema<ModelShape>;
    const shape = model.shape as Record<string, SchemaNode>;
    return Object.entries(shape).map(([fieldName, fieldSchema]) =>
      describeSchema(fieldName, fieldSchema),
    );
  }

  return null;
}

/**
 * Resolve the effective kind. For NumberSchema, we read `numberType`
 * to distinguish int32/int64/float32/float64 instead of the generic 'number'.
 */
function resolveKind(schema: SchemaNode): string {
  if (schema.kind === 'number') {
    const num = schema as NumberSchema;
    return num.numberType;
  }
  return schema.kind;
}

function extractConstraints(schema: SchemaNode): FieldConstraints {
  const c: FieldConstraints = {};

  switch (schema.kind) {
    case 'string': {
      const s = schema as StringSchema;
      if (s.constraints.minLength !== undefined) c.minLength = s.constraints.minLength;
      if (s.constraints.maxLength !== undefined) c.maxLength = s.constraints.maxLength;
      if (s.constraints.pattern !== undefined) c.pattern = s.constraints.pattern.source;
      if (s.constraints.format !== undefined) c.format = s.constraints.format;
      break;
    }
    case 'number': {
      const n = schema as NumberSchema;
      if (n.constraints.min !== undefined) c.min = n.constraints.min;
      if (n.constraints.max !== undefined) c.max = n.constraints.max;
      if (n.constraints.exclusiveMin !== undefined) c.exclusiveMin = n.constraints.exclusiveMin;
      if (n.constraints.exclusiveMax !== undefined) c.exclusiveMax = n.constraints.exclusiveMax;
      if (n.constraints.multipleOf !== undefined) c.multipleOf = n.constraints.multipleOf;
      break;
    }
    case 'enum': {
      const e = schema as EnumSchema<readonly [string, ...string[]]>;
      c.enumValues = e.values;
      break;
    }
    case 'array': {
      const a = schema as ArraySchema<SchemaNode>;
      if (a.constraints.minItems !== undefined) c.minItems = a.constraints.minItems;
      if (a.constraints.maxItems !== undefined) c.maxItems = a.constraints.maxItems;
      if (a.constraints.uniqueItems !== undefined) c.uniqueItems = a.constraints.uniqueItems;
      break;
    }
    case 'file': {
      const f = schema as FileSchema;
      if (f.constraints.minSize !== undefined) c.minSize = f.constraints.minSize;
      if (f.constraints.maxSize !== undefined) c.maxSize = f.constraints.maxSize;
      if (f.constraints.mimeTypes !== undefined) c.mimeTypes = f.constraints.mimeTypes;
      break;
    }
    case 'literal': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l = schema as LiteralSchema<any>;
      c.literalValue = l.value as string | number | boolean;
      break;
    }
  }

  return c;
}

function extractChildren(schema: SchemaNode): FieldDescriptor[] | undefined {
  if (schema.kind === 'model') {
    const model = schema as ModelSchema<ModelShape>;
    const shape = model.shape as Record<string, SchemaNode>;
    return Object.entries(shape).map(([fieldName, fieldSchema]) =>
      describeSchema(fieldName, fieldSchema),
    );
  }

  if (schema.kind === 'array') {
    const arr = schema as ArraySchema<SchemaNode>;
    const itemDesc = describeSchema('[]', arr.item);
    return [itemDesc];
  }

  return undefined;
}
