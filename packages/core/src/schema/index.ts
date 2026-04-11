/**
 * The `t` namespace — Triad's schema DSL entry point.
 *
 * ```ts
 * import { t } from '@triad/core';
 *
 * const Pet = t.model('Pet', {
 *   id: t.string().format('uuid').identity(),
 *   name: t.string().minLength(1),
 *   species: t.enum('dog', 'cat', 'bird', 'fish'),
 *   age: t.int32().min(0).max(100),
 *   tags: t.array(t.string()).optional(),
 * });
 * ```
 */

import { StringSchema } from './string.js';
import { NumberSchema } from './number.js';
import { BooleanSchema } from './boolean.js';
import { DateTimeSchema } from './datetime.js';
import { EnumSchema } from './enum.js';
import { LiteralSchema, type LiteralBase } from './literal.js';
import { UnknownSchema } from './unknown.js';
import { EmptySchema } from './empty.js';
import { FileSchema } from './file.js';
import { ArraySchema } from './array.js';
import { RecordSchema } from './record.js';
import { TupleSchema } from './tuple.js';
import { UnionSchema } from './union.js';
import { ModelSchema, type ModelShape } from './model.js';
import { ValueSchema } from './value.js';
import type { SchemaNode, Infer as InferT } from './types.js';

export const t = {
  // Primitives
  string: () => new StringSchema(),
  int32: () => new NumberSchema('int32'),
  int64: () => new NumberSchema('int64'),
  float32: () => new NumberSchema('float32'),
  float64: () => new NumberSchema('float64'),
  boolean: () => new BooleanSchema(),
  datetime: () => new DateTimeSchema(),
  unknown: () => new UnknownSchema(),
  empty: () => new EmptySchema(),
  file: () => new FileSchema(),

  enum: <const V extends readonly [string, ...string[]]>(...values: V) =>
    new EnumSchema<V>(values),

  literal: <const V extends LiteralBase>(value: V) => new LiteralSchema<V>(value),

  // Collections
  array: <TItem extends SchemaNode>(item: TItem) => new ArraySchema<TItem>(item),

  record: <TValue extends SchemaNode>(keySchema: StringSchema, valueSchema: TValue) =>
    new RecordSchema<TValue>(keySchema, valueSchema),

  tuple: <const TItems extends readonly SchemaNode[]>(...items: TItems) =>
    new TupleSchema<TItems>(items),

  union: <const TOptions extends readonly [SchemaNode, ...SchemaNode[]]>(
    ...options: TOptions
  ) => new UnionSchema<TOptions>(options),

  // DDD
  model: <TShape extends ModelShape>(name: string, shape: TShape) =>
    new ModelSchema<TShape>(name, shape),

  value: <TInner extends SchemaNode | ModelShape>(name: string, inner: TInner) =>
    new ValueSchema<TInner>(name, inner),
};

/**
 * Namespace merge: `t.infer<typeof Pet>` works as a type-level operation,
 * while `t.string()`, `t.model(...)` etc. work as runtime values.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace t {
  export type infer<T extends SchemaNode> = InferT<T>;
}

// Re-export schema classes for users who need direct access.
export {
  StringSchema,
  NumberSchema,
  BooleanSchema,
  DateTimeSchema,
  EnumSchema,
  LiteralSchema,
  UnknownSchema,
  EmptySchema,
  FileSchema,
  ArraySchema,
  RecordSchema,
  TupleSchema,
  UnionSchema,
  ModelSchema,
  ValueSchema,
};

export { isEmptySchema } from './empty.js';
export { isFileSchema, hasFileFields, type TriadFile, type FileConstraints } from './file.js';
