import {
  SchemaNode,
  joinPath,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';
import type { ModelShape, InferShape } from './model.js';

/**
 * DDD Value Object schema.
 *
 * A `ValueSchema` is either:
 *   - A wrapper around a single primitive schema (e.g. `t.value('Email', t.string().format('email'))`)
 *   - A composite of fields (e.g. `t.value('Money', { amount: t.float64(), currency: t.enum(...) })`)
 *
 * Differences from `ModelSchema`:
 *   - Immutable by semantics (no `.partial()`, no field-level identity)
 *   - Emits inline OpenAPI schemas (not `$ref` components)
 *   - No entity identity semantics
 */

type ValueInner = SchemaNode | ModelShape;

type InferValue<T extends ValueInner> = T extends SchemaNode<infer U>
  ? U
  : T extends ModelShape
    ? InferShape<T>
    : never;

export class ValueSchema<
  TInner extends ValueInner,
  TOutput = InferValue<TInner>,
> extends SchemaNode<TOutput> {
  readonly kind = 'value';

  constructor(
    public readonly name: string,
    public readonly inner: TInner,
    metadata: SchemaMetadata = {},
    isOptional = false,
    isNullable = false,
  ) {
    super(metadata, isOptional, isNullable);
  }

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new ValueSchema<TInner, TOutput>(
      this.name,
      this.inner,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): ValueSchema<TInner, TOutput | undefined> {
    return new ValueSchema<TInner, TOutput | undefined>(
      this.name,
      this.inner,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): ValueSchema<TInner, TOutput | null> {
    return new ValueSchema<TInner, TOutput | null>(
      this.name,
      this.inner,
      this.metadata,
      this.isOptional,
      true,
    );
  }

  protected _validate(
    value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown {
    if (this.inner instanceof SchemaNode) {
      return this.inner._validateAt(value, path, errors);
    }
    // Composite shape
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected ${this.name} value object, received ${Array.isArray(value) ? 'array' : typeof value}`,
      });
      return value;
    }
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(this.inner)) {
      out[k] = schema._validateAt(input[k], joinPath(path, k), errors);
    }
    return out;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    if (this.inner instanceof SchemaNode) {
      const inner = this.inner.toOpenAPI(ctx);
      return { ...inner, title: this.name };
    }
    const properties: Record<string, OpenAPISchema> = {};
    const required: string[] = [];
    for (const [k, schema] of Object.entries(this.inner)) {
      properties[k] = schema.toOpenAPI(ctx);
      if (!schema.isOptional && schema.metadata.default === undefined) {
        required.push(k);
      }
    }
    const out: OpenAPISchema = {
      type: 'object',
      title: this.name,
      properties,
    };
    if (required.length > 0) out.required = required;
    return out;
  }
}
