/**
 * Router → `TableDescriptor[]` walker.
 *
 * A model becomes a table if **any of its fields has
 * `.storage({ primaryKey: true })`**. This heuristic is deliberate:
 *
 *   - Derived schemas (`Pet.pick('name', 'species')`) usually don't have
 *     the id field, so they don't become tables.
 *   - Input DTOs (`CreatePet`, `UpdatePet`) don't have primary keys.
 *   - `ApiError` and other shared response shapes don't have primary keys.
 *   - Value objects (`Money`) aren't `ModelSchema` instances — they're
 *     flattened into their host table's columns.
 *
 * A bare `.identity()` on a field is NOT enough — identity is a domain
 * concept, `primaryKey` is a storage concept. A future phase could add
 * a "promote identity to primary key" heuristic, but being explicit
 * right now prevents surprising generated output.
 *
 * Every walk is structural (via the `kind` discriminator), not
 * `instanceof`-based, so codegen works with routers loaded from any
 * module graph.
 */

import type { Router, SchemaNode } from '@triad/core';
import type {
  ColumnDescriptor,
  GenerateOptions,
  LogicalColumnType,
  TableDescriptor,
} from './types.js';

// ---------------------------------------------------------------------------
// Structural schema views
// ---------------------------------------------------------------------------

interface ModelLike {
  readonly kind: 'model';
  readonly name: string;
  readonly shape: Record<string, SchemaNode>;
}
interface ValueLike {
  readonly kind: 'value';
  readonly name: string;
  readonly inner: SchemaNode | Record<string, SchemaNode>;
}
interface ArrayLike {
  readonly kind: 'array';
  readonly item: SchemaNode;
}
interface EnumLike {
  readonly kind: 'enum';
  readonly values: readonly string[];
}

function asModel(node: SchemaNode): ModelLike | undefined {
  return node.kind === 'model' ? (node as unknown as ModelLike) : undefined;
}
function asValue(node: SchemaNode): ValueLike | undefined {
  return node.kind === 'value' ? (node as unknown as ValueLike) : undefined;
}
function asArray(node: SchemaNode): ArrayLike | undefined {
  return node.kind === 'array' ? (node as unknown as ArrayLike) : undefined;
}
function asEnum(node: SchemaNode): EnumLike | undefined {
  return node.kind === 'enum' ? (node as unknown as EnumLike) : undefined;
}

function isValueShape(
  inner: SchemaNode | Record<string, SchemaNode>,
): inner is Record<string, SchemaNode> {
  // Plain object shapes don't have a `kind` discriminant; SchemaNode
  // instances always do.
  return (
    typeof inner === 'object' &&
    inner !== null &&
    typeof (inner as { kind?: unknown }).kind !== 'string'
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Collect every ModelSchema reachable from a router, indexed by name. */
function collectModels(router: Router): Map<string, ModelLike> {
  const registry = new Map<string, ModelLike>();
  const visit = (schema: SchemaNode | undefined): void => {
    if (!schema) return;
    const model = asModel(schema);
    if (model) {
      if (registry.has(model.name)) return;
      registry.set(model.name, model);
      for (const field of Object.values(model.shape)) visit(field);
      return;
    }
    const arr = asArray(schema);
    if (arr) return visit(arr.item);
    // Unions, tuples, records, values — we only care about top-level
    // tables, so no need to recurse deeper than arrays in this walker.
  };
  for (const endpoint of router.allEndpoints()) {
    visit(endpoint.request.body);
    for (const response of Object.values(endpoint.responses)) {
      visit(response.schema);
    }
  }
  return registry;
}

/** Does this model have at least one field marked as a primary key? */
function isTableModel(model: ModelLike): boolean {
  for (const field of Object.values(model.shape)) {
    if (field.metadata.storage?.primaryKey) return true;
  }
  return false;
}

/**
 * Walk a router and extract all table descriptors. Tables are returned
 * in the order their models were first encountered so output is
 * deterministic for snapshot tests.
 */
export function walkRouter(
  router: Router,
  options: GenerateOptions = {},
): TableDescriptor[] {
  const models = collectModels(router);
  const tables: TableDescriptor[] = [];
  for (const [name, model] of models) {
    if (!isTableModel(model)) continue;
    tables.push(modelToTable(name, model, options));
  }
  return tables;
}

// ---------------------------------------------------------------------------
// Model → TableDescriptor
// ---------------------------------------------------------------------------

function modelToTable(
  modelName: string,
  model: ModelLike,
  options: GenerateOptions,
): TableDescriptor {
  const columns: ColumnDescriptor[] = [];
  for (const [fieldName, fieldSchema] of Object.entries(model.shape)) {
    const value = asValue(fieldSchema);
    if (value) {
      columns.push(...expandValueObject(fieldName, value));
      continue;
    }
    const nested = asModel(fieldSchema);
    if (nested) {
      throw new CodegenError(
        `Field "${modelName}.${fieldName}" references model "${nested.name}" directly. ` +
          `Nested models cannot be auto-generated as foreign keys — replace with a ` +
          `string field that carries .storage({ references: '${defaultTableName(nested.name)}.id' }).`,
      );
    }
    columns.push(fieldToColumn(fieldName, fieldSchema));
  }
  return {
    identifier: defaultTableName(modelName),
    tableName: options.tableNames?.[modelName] ?? defaultTableName(modelName),
    modelName,
    columns,
  };
}

function defaultTableName(modelName: string): string {
  // Lowercase + 's' pluralization. This is deliberately simple. Users who
  // need different naming pass `tableNames` in options.
  const lower = modelName.toLowerCase();
  if (lower.endsWith('s')) return lower;
  return `${lower}s`;
}

// ---------------------------------------------------------------------------
// Field → ColumnDescriptor
// ---------------------------------------------------------------------------

function fieldToColumn(
  fieldName: string,
  schema: SchemaNode,
): ColumnDescriptor {
  const storage = schema.metadata.storage ?? {};
  const columnName = storage.columnName ?? toSnakeCase(fieldName);

  const typeInfo = inferLogicalType(schema);
  const column: ColumnDescriptor = {
    fieldName,
    columnName,
    logicalType: typeInfo.logicalType,
    primaryKey: storage.primaryKey === true,
    notNull: !schema.isOptional,
    unique: storage.unique === true,
  };

  if (typeInfo.enumValues !== undefined) column.enumValues = typeInfo.enumValues;
  if (typeInfo.comment !== undefined) column.comment = typeInfo.comment;
  if (typeInfo.maxLength !== undefined) column.maxLength = typeInfo.maxLength;

  if (storage.references !== undefined) {
    column.references = storage.references;
  }

  // Defaults — Triad .default() and .storage() defaults can coexist.
  if (storage.defaultNow) {
    column.default = { kind: 'now' };
  } else if (storage.defaultRandom) {
    column.default = { kind: 'random' };
  } else if (schema.metadata.default !== undefined) {
    const value = schema.metadata.default;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      column.default = { kind: 'literal', value };
    }
  }

  return column;
}

interface TypeInfo {
  logicalType: LogicalColumnType;
  enumValues?: readonly string[];
  comment?: string;
  maxLength?: number;
}

/**
 * Map a Triad schema node to a dialect-neutral logical column type.
 *
 * The rules consider the kind AND secondary signals (numeric
 * `numberType`, string `format`) so that downstream emitters can pick
 * dialect-specific helpers — `t.string().format('uuid')` becomes a real
 * `uuid` column in Postgres but a plain `text` column in SQLite.
 */
function inferLogicalType(schema: SchemaNode): TypeInfo {
  const { kind } = schema;
  switch (kind) {
    case 'string': {
      const constraints = (
        schema as unknown as {
          constraints?: { format?: string; maxLength?: number };
        }
      ).constraints;
      if (constraints?.format === 'uuid') {
        return { logicalType: 'uuid' };
      }
      const info: TypeInfo = { logicalType: 'string' };
      if (typeof constraints?.maxLength === 'number') {
        info.maxLength = constraints.maxLength;
      }
      return info;
    }
    case 'datetime':
      return { logicalType: 'datetime', comment: 'ISO 8601 date-time string' };
    case 'enum': {
      const e = asEnum(schema)!;
      return { logicalType: 'enum', enumValues: e.values };
    }
    case 'literal':
      return { logicalType: 'string' };
    case 'boolean':
      return { logicalType: 'boolean' };
    case 'number': {
      const numberType = (schema as unknown as { numberType?: string })
        .numberType;
      switch (numberType) {
        case 'int64':
          return { logicalType: 'bigint' };
        case 'float32':
          return { logicalType: 'float' };
        case 'float64':
          return { logicalType: 'double' };
        case 'int32':
        default:
          return { logicalType: 'integer' };
      }
    }
    case 'array':
      return { logicalType: 'json', comment: 'JSON-serialized array' };
    case 'record':
      return { logicalType: 'json', comment: 'JSON-serialized record' };
    case 'tuple':
      return { logicalType: 'json', comment: 'JSON-serialized tuple' };
    case 'union':
      return { logicalType: 'json', comment: 'JSON-serialized union value' };
    case 'unknown':
      return { logicalType: 'json', comment: 'opaque JSON' };
    default:
      throw new CodegenError(
        `Unsupported schema kind "${kind}" for column generation.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Value object expansion
// ---------------------------------------------------------------------------

/**
 * Flatten a composite value object into multiple columns. A single-field
 * value (e.g. `t.value('Email', t.string().format('email'))`) becomes one
 * column named after the outer field; a multi-field value (e.g.
 * `Money`) becomes one column per inner field, prefixed with the outer
 * field's camelCase name.
 */
function expandValueObject(
  outerFieldName: string,
  value: ValueLike,
): ColumnDescriptor[] {
  if (!isValueShape(value.inner)) {
    // Single-schema value object — emit one column with the outer name.
    const column = fieldToColumn(outerFieldName, value.inner);
    return [column];
  }

  const columns: ColumnDescriptor[] = [];
  for (const [innerName, innerSchema] of Object.entries(value.inner)) {
    const combined = `${outerFieldName}${capitalize(innerName)}`;
    const storage = innerSchema.metadata.storage ?? {};
    const columnName = storage.columnName ?? toSnakeCase(combined);

    const typeInfo = inferLogicalType(innerSchema);
    const column: ColumnDescriptor = {
      fieldName: combined,
      columnName,
      logicalType: typeInfo.logicalType,
      primaryKey: false, // value objects never carry the table primary key
      notNull: !innerSchema.isOptional,
      unique: storage.unique === true,
    };
    if (typeInfo.enumValues !== undefined) {
      column.enumValues = typeInfo.enumValues;
    }
    if (typeInfo.comment !== undefined) column.comment = typeInfo.comment;
    if (typeInfo.maxLength !== undefined) column.maxLength = typeInfo.maxLength;
    columns.push(column);
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Helpers + errors
// ---------------------------------------------------------------------------

/** `adoptionFeeAmount` → `adoption_fee_amount`. */
export function toSnakeCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodegenError';
  }
}
