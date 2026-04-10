import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

export type LiteralBase = string | number | boolean;

export class LiteralSchema<
  TValue extends LiteralBase,
  TOutput = TValue,
> extends SchemaNode<TOutput> {
  readonly kind = 'literal';

  constructor(
    public readonly value: TValue,
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
    return new LiteralSchema<TValue, TOutput>(
      this.value,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): LiteralSchema<TValue, TOutput | undefined> {
    return new LiteralSchema<TValue, TOutput | undefined>(
      this.value,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): LiteralSchema<TValue, TOutput | null> {
    return new LiteralSchema<TValue, TOutput | null>(
      this.value,
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
    if (value !== this.value) {
      errors.push({
        path,
        code: 'invalid_literal',
        message: `Expected literal ${JSON.stringify(this.value)}, received ${JSON.stringify(value)}`,
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    return { const: this.value };
  }
}
