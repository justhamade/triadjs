import {
  SchemaNode,
  joinPath,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';
import type { StringSchema } from './string.js';

type InferValue<T extends SchemaNode> = T extends SchemaNode<infer U> ? U : never;

export class RecordSchema<
  TValue extends SchemaNode,
  TOutput = Record<string, InferValue<TValue>>,
> extends SchemaNode<TOutput> {
  readonly kind = 'record';

  constructor(
    public readonly keySchema: StringSchema,
    public readonly valueSchema: TValue,
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
    return new RecordSchema<TValue, TOutput>(
      this.keySchema,
      this.valueSchema,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): RecordSchema<TValue, TOutput | undefined> {
    return new RecordSchema<TValue, TOutput | undefined>(
      this.keySchema,
      this.valueSchema,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): RecordSchema<TValue, TOutput | null> {
    return new RecordSchema<TValue, TOutput | null>(
      this.keySchema,
      this.valueSchema,
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
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected object, received ${Array.isArray(value) ? 'array' : typeof value}`,
      });
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Validate key shape
      this.keySchema._validateAt(k, joinPath(path, k), errors);
      out[k] = this.valueSchema._validateAt(v, joinPath(path, k), errors);
    }
    return out;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    return {
      type: 'object',
      additionalProperties: this.valueSchema.toOpenAPI(ctx),
    };
  }
}
