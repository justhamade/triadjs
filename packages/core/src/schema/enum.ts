import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

export class EnumSchema<
  TValues extends readonly [string, ...string[]],
  TOutput = TValues[number],
> extends SchemaNode<TOutput> {
  readonly kind = 'enum';

  constructor(
    public readonly values: TValues,
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
    return new EnumSchema<TValues, TOutput>(
      this.values,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): EnumSchema<TValues, TOutput | undefined> {
    return new EnumSchema<TValues, TOutput | undefined>(
      this.values,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): EnumSchema<TValues, TOutput | null> {
    return new EnumSchema<TValues, TOutput | null>(
      this.values,
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
    if (typeof value !== 'string' || !(this.values as readonly string[]).includes(value)) {
      errors.push({
        path,
        code: 'invalid_enum',
        message: `Expected one of [${this.values.join(', ')}], received ${JSON.stringify(value)}`,
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    return { type: 'string', enum: [...this.values] };
  }
}
