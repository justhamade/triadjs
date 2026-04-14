/**
 * Walk a Triad schema tree and emit a deterministic piece of fake data
 * that validates against the schema.
 *
 * Used by `triad mock` to synthesize happy-path response bodies when
 * no real handler is available. Dispatches on the `kind` discriminant
 * of every `SchemaNode` subclass.
 *
 * Contract:
 *   - Every produced value MUST round-trip through `schema.parse()`.
 *   - Output is deterministic given the same `seed`.
 *   - Unknown kinds fall through to `null` so new schema types added
 *     later surface as "obviously fake" rather than crashing the mock.
 */

import type {
  SchemaNode,
  StringSchema,
  NumberSchema,
  EnumSchema,
  LiteralSchema,
  ArraySchema,
  TupleSchema,
  UnionSchema,
  ModelSchema,
  ValueSchema,
  RecordSchema,
  ModelShape,
} from '@triadjs/core';

export interface FakeDataOptions {
  /** Seed the deterministic RNG. Same seed → same output. */
  seed?: number;
}

interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
}

/**
 * Small, dependency-free linear congruential generator. Not
 * cryptographically sound, but that's fine — the only goal is
 * reproducible mock output.
 */
function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return {
    next,
    int(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(arr: readonly T[]): T {
      const i = Math.floor(next() * arr.length);
      return arr[i] as T;
    },
  };
}

const DEFAULT_SEED = 0xc0ffee;

const FIXED_UUID = '00000000-0000-4000-8000-000000000000';
const FIXED_EMAIL = 'fake@example.com';
const FIXED_URI = 'https://example.com/fake';
const FIXED_HOSTNAME = 'example.com';
const FIXED_IPV4 = '127.0.0.1';
const FIXED_IPV6 = '::1';
const FIXED_DATE = '2024-01-15';
const FIXED_TIME = '12:34:56';
const FIXED_DATETIME = '2024-01-15T12:34:56.000Z';
const FIXED_DURATION = 'PT1H';

export function fakeFromSchema<T = unknown>(
  schema: SchemaNode,
  options: FakeDataOptions = {},
): T {
  const rng = createRng(options.seed ?? DEFAULT_SEED);
  return fakeNode(schema, rng) as T;
}

function fakeNode(node: SchemaNode, rng: Rng): unknown {
  // Respect explicit examples supplied on the schema.
  if (node.metadata.example !== undefined) return node.metadata.example;
  if (node.metadata.default !== undefined) return node.metadata.default;

  switch (node.kind) {
    case 'string':
      return fakeString(node as StringSchema, rng);
    case 'number':
      return fakeNumber(node as NumberSchema, rng);
    case 'boolean':
      return true;
    case 'datetime':
      return FIXED_DATETIME;
    case 'enum':
      return (node as EnumSchema<readonly [string, ...string[]]>).values[0];
    case 'literal':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (node as LiteralSchema<any>).value;
    case 'unknown':
      return null;
    case 'empty':
      return undefined;
    case 'file':
      return undefined;
    case 'array':
      return fakeArray(node as ArraySchema<SchemaNode>, rng);
    case 'record':
      return fakeRecord(node as RecordSchema<SchemaNode>, rng);
    case 'tuple':
      return fakeTuple(node as TupleSchema<readonly SchemaNode[]>, rng);
    case 'union':
      return fakeUnion(node as UnionSchema<readonly SchemaNode[]>, rng);
    case 'model':
      return fakeModel(node as ModelSchema<ModelShape>, rng);
    case 'value':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fakeValue(node as ValueSchema<any>, rng);
    default:
      return null;
  }
}

function fakeString(node: StringSchema, rng: Rng): string {
  const { format, minLength, maxLength, pattern } = node.constraints;
  if (format !== undefined) {
    const formatted = stringForFormat(format);
    if (formatted !== undefined) return clampLength(formatted, minLength, maxLength);
  }
  if (pattern !== undefined) {
    // Best-effort: if the schema has a pattern, surface a TODO value
    // and hope the user-provided pattern is permissive. We cannot
    // generate from an arbitrary regex without adding a dep.
    const candidate = 'x';
    if (pattern.test(candidate)) return clampLength(candidate, minLength, maxLength);
  }
  const min = minLength ?? 1;
  const max = maxLength ?? Math.max(min, 8);
  const len = rng.int(min, Math.max(min, max));
  return randomAscii(len, rng);
}

function stringForFormat(format: string): string | undefined {
  switch (format) {
    case 'uuid':
      return FIXED_UUID;
    case 'email':
      return FIXED_EMAIL;
    case 'uri':
    case 'url':
      return FIXED_URI;
    case 'hostname':
      return FIXED_HOSTNAME;
    case 'ipv4':
      return FIXED_IPV4;
    case 'ipv6':
      return FIXED_IPV6;
    case 'date':
      return FIXED_DATE;
    case 'date-time':
      return FIXED_DATETIME;
    case 'time':
      return FIXED_TIME;
    case 'duration':
      return FIXED_DURATION;
    default:
      return undefined;
  }
}

function clampLength(value: string, min?: number, max?: number): string {
  let out = value;
  if (max !== undefined && out.length > max) out = out.slice(0, max);
  if (min !== undefined && out.length < min) {
    out = out.padEnd(min, 'x');
  }
  return out;
}

function randomAscii(len: number, rng: Rng): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[rng.int(0, alphabet.length - 1)];
  }
  return out;
}

function fakeNumber(node: NumberSchema, rng: Rng): number {
  const { min, max, exclusiveMin, exclusiveMax, multipleOf } = node.constraints;
  const isInt = node.numberType === 'int32' || node.numberType === 'int64';
  const lowerBound =
    exclusiveMin !== undefined ? exclusiveMin + (isInt ? 1 : 0.001) : (min ?? 0);
  const upperBound =
    exclusiveMax !== undefined ? exclusiveMax - (isInt ? 1 : 0.001) : (max ?? 100);
  const low = Math.min(lowerBound, upperBound);
  const high = Math.max(lowerBound, upperBound);
  let value: number;
  if (isInt) {
    value = rng.int(Math.ceil(low), Math.floor(high));
  } else {
    value = low + rng.next() * (high - low);
    value = Math.round(value * 1000) / 1000;
  }
  if (multipleOf !== undefined && multipleOf > 0) {
    value = Math.round(value / multipleOf) * multipleOf;
    if (value < low) value = Math.ceil(low / multipleOf) * multipleOf;
    if (value > high) value = Math.floor(high / multipleOf) * multipleOf;
  }
  return value;
}

function fakeArray(node: ArraySchema<SchemaNode>, rng: Rng): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const constraints = (node as any).constraints as
    | { minItems?: number; maxItems?: number }
    | undefined;
  const min = constraints?.minItems ?? 1;
  const max = constraints?.maxItems ?? 3;
  const count = Math.max(min, Math.min(max, 3));
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    out.push(fakeNode(node.item, rng));
  }
  return out;
}

function fakeRecord(_node: RecordSchema<SchemaNode>, _rng: Rng): Record<string, unknown> {
  return {};
}

function fakeTuple(node: TupleSchema<readonly SchemaNode[]>, rng: Rng): unknown[] {
  return node.items.map((item) => fakeNode(item, rng));
}

function fakeUnion(
  node: UnionSchema<readonly SchemaNode[]>,
  rng: Rng,
): unknown {
  const first = node.options[0];
  if (first === undefined) return null;
  return fakeNode(first, rng);
}

function fakeModel(node: ModelSchema<ModelShape>, rng: Rng): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(node.shape as ModelShape)) {
    if (field.isOptional) continue;
    out[key] = fakeNode(field, rng);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeValue(node: ValueSchema<any>, rng: Rng): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (node as any).inner as SchemaNode | ModelShape;
  if (isSchemaNode(inner)) {
    return fakeNode(inner, rng);
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(inner)) {
    if ((field as SchemaNode).isOptional) continue;
    out[key] = fakeNode(field as SchemaNode, rng);
  }
  return out;
}

function isSchemaNode(v: unknown): v is SchemaNode {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { kind?: unknown }).kind === 'string'
  );
}
