import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

type InferUnion<T extends readonly SchemaNode[]> = T[number] extends SchemaNode<infer U>
  ? U
  : never;

export class UnionSchema<
  TOptions extends readonly SchemaNode[],
  TOutput = InferUnion<TOptions>,
> extends SchemaNode<TOutput> {
  readonly kind = 'union';

  constructor(
    public readonly options: TOptions,
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
    return new UnionSchema<TOptions, TOutput>(
      this.options,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): UnionSchema<TOptions, TOutput | undefined> {
    return new UnionSchema<TOptions, TOutput | undefined>(
      this.options,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): UnionSchema<TOptions, TOutput | null> {
    return new UnionSchema<TOptions, TOutput | null>(
      this.options,
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
    // Try each option, collect errors from each branch.
    // If any branch succeeds, use it. Otherwise, merge branch errors into a single union error.
    const branchErrors: ValidationError[][] = [];
    for (const option of this.options) {
      const branch: ValidationError[] = [];
      const result = option._validateAt(value, path, branch);
      if (branch.length === 0) {
        return result;
      }
      branchErrors.push(branch);
    }
    errors.push({
      path,
      code: 'no_union_match',
      message: `Value did not match any of ${this.options.length} union options`,
    });
    return value;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    return {
      oneOf: this.options.map((o) => o.toOpenAPI(ctx)),
    };
  }
}
