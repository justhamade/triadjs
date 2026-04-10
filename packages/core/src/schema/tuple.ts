import {
  SchemaNode,
  joinPath,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

type InferTuple<T extends readonly SchemaNode[]> = {
  -readonly [K in keyof T]: T[K] extends SchemaNode<infer U> ? U : never;
};

export class TupleSchema<
  TItems extends readonly SchemaNode[],
  TOutput = InferTuple<TItems>,
> extends SchemaNode<TOutput> {
  readonly kind = 'tuple';

  constructor(
    public readonly items: TItems,
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
    return new TupleSchema<TItems, TOutput>(
      this.items,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): TupleSchema<TItems, TOutput | undefined> {
    return new TupleSchema<TItems, TOutput | undefined>(
      this.items,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): TupleSchema<TItems, TOutput | null> {
    return new TupleSchema<TItems, TOutput | null>(
      this.items,
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
    if (!Array.isArray(value)) {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected tuple, received ${typeof value}`,
      });
      return value;
    }
    if (value.length !== this.items.length) {
      errors.push({
        path,
        code: 'tuple_length',
        message: `Expected tuple of length ${this.items.length}, received ${value.length}`,
      });
    }
    const out: unknown[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      out.push(item._validateAt(value[i], joinPath(path, i), errors));
    }
    return out;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    return {
      type: 'array',
      prefixItems: this.items.map((item) => item.toOpenAPI(ctx)),
      minItems: this.items.length,
      maxItems: this.items.length,
    };
  }
}
