import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

export class BooleanSchema<TOutput = boolean> extends SchemaNode<TOutput> {
  readonly kind = 'boolean';

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new BooleanSchema<TOutput>(metadata, isOptional, isNullable) as this;
  }

  optional(): BooleanSchema<TOutput | undefined> {
    return new BooleanSchema<TOutput | undefined>(this.metadata, true, this.isNullable);
  }

  nullable(): BooleanSchema<TOutput | null> {
    return new BooleanSchema<TOutput | null>(this.metadata, this.isOptional, true);
  }

  protected _validate(
    value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown {
    if (typeof value !== 'boolean') {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected boolean, received ${typeof value}`,
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    return { type: 'boolean' };
  }
}
