import {
  SchemaNode,
  joinPath,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

interface ArrayConstraints {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

type InferItem<T extends SchemaNode> = T extends SchemaNode<infer U> ? U : never;

export class ArraySchema<
  TItem extends SchemaNode,
  TOutput = Array<InferItem<TItem>>,
> extends SchemaNode<TOutput> {
  readonly kind = 'array';

  constructor(
    public readonly item: TItem,
    metadata: SchemaMetadata = {},
    isOptional = false,
    isNullable = false,
    public readonly constraints: Readonly<ArrayConstraints> = {},
  ) {
    super(metadata, isOptional, isNullable);
  }

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new ArraySchema<TItem, TOutput>(
      this.item,
      metadata,
      isOptional,
      isNullable,
      this.constraints,
    ) as this;
  }

  private _with(next: ArrayConstraints): ArraySchema<TItem, TOutput> {
    return new ArraySchema<TItem, TOutput>(
      this.item,
      this.metadata,
      this.isOptional,
      this.isNullable,
      { ...this.constraints, ...next },
    );
  }

  minItems(n: number): ArraySchema<TItem, TOutput> {
    return this._with({ minItems: n });
  }

  maxItems(n: number): ArraySchema<TItem, TOutput> {
    return this._with({ maxItems: n });
  }

  uniqueItems(flag = true): ArraySchema<TItem, TOutput> {
    return this._with({ uniqueItems: flag });
  }

  optional(): ArraySchema<TItem, TOutput | undefined> {
    return new ArraySchema<TItem, TOutput | undefined>(
      this.item,
      this.metadata,
      true,
      this.isNullable,
      this.constraints,
    );
  }

  nullable(): ArraySchema<TItem, TOutput | null> {
    return new ArraySchema<TItem, TOutput | null>(
      this.item,
      this.metadata,
      this.isOptional,
      true,
      this.constraints,
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
        message: `Expected array, received ${typeof value}`,
      });
      return value;
    }
    const { minItems, maxItems, uniqueItems } = this.constraints;
    if (minItems !== undefined && value.length < minItems) {
      errors.push({
        path,
        code: 'min_items',
        message: `Array must have at least ${minItems} items (received ${value.length})`,
      });
    }
    if (maxItems !== undefined && value.length > maxItems) {
      errors.push({
        path,
        code: 'max_items',
        message: `Array must have at most ${maxItems} items (received ${value.length})`,
      });
    }
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(this.item._validateAt(value[i], joinPath(path, i), errors));
    }
    if (uniqueItems) {
      const seen = new Set<string>();
      for (let i = 0; i < out.length; i++) {
        const key = JSON.stringify(out[i]);
        if (seen.has(key)) {
          errors.push({
            path: joinPath(path, i),
            code: 'duplicate_item',
            message: 'Array items must be unique',
          });
        }
        seen.add(key);
      }
    }
    return out;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    const schema: OpenAPISchema = {
      type: 'array',
      items: this.item.toOpenAPI(ctx),
    };
    const { minItems, maxItems, uniqueItems } = this.constraints;
    if (minItems !== undefined) schema.minItems = minItems;
    if (maxItems !== undefined) schema.maxItems = maxItems;
    if (uniqueItems) schema.uniqueItems = true;
    return schema;
  }
}
