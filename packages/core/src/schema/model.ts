import {
  SchemaNode,
  joinPath,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
  type Infer,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelShape = Record<string, SchemaNode<any>>;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type FieldOutput<F> = F extends SchemaNode<infer U> ? U : never;

type OptionalKeys<T> = {
  [K in keyof T]: undefined extends FieldOutput<T[K]> ? K : never;
}[keyof T];

type RequiredKeys<T> = {
  [K in keyof T]: undefined extends FieldOutput<T[K]> ? never : K;
}[keyof T];

export type InferShape<T> = Prettify<
  { [K in RequiredKeys<T>]: FieldOutput<T[K]> } & {
    [K in OptionalKeys<T>]?: Exclude<FieldOutput<T[K]>, undefined>;
  }
>;

type PartialShape<T> = {
  [K in keyof T]: T[K] extends SchemaNode<infer U>
    ? SchemaNode<U | undefined>
    : T[K];
};

type RequiredShape<T> = {
  [K in keyof T]: T[K] extends SchemaNode<infer U>
    ? SchemaNode<Exclude<U, undefined>>
    : T[K];
};

/**
 * NOTE on the TShape constraint:
 *
 * We use a self-referential constraint `TShape extends { [K in keyof TShape]:
 * SchemaNode<any> }` instead of `TShape extends ModelShape`. The difference is
 * crucial for type inference: a direct `Record<string, SchemaNode<any>>`
 * constraint makes TS apply it as a contextual type over every field of a
 * passed object literal, which *widens* each field's generic (e.g. an
 * `EnumSchema<['dog','cat']>` collapses into a bare `SchemaNode<any>`). The
 * self-referential form only requires each individual field to be a
 * `SchemaNode`, so TS preserves the exact inferred type per field.
 */
export class ModelSchema<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TShape extends { [K in keyof TShape]: SchemaNode<any> },
  TOutput = InferShape<TShape>,
> extends SchemaNode<TOutput> {
  readonly kind = 'model';

  constructor(
    public readonly name: string,
    public readonly shape: TShape,
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
    return new ModelSchema<TShape, TOutput>(
      this.name,
      this.shape,
      metadata,
      isOptional,
      isNullable,
    ) as this;
  }

  optional(): ModelSchema<TShape, TOutput | undefined> {
    return new ModelSchema<TShape, TOutput | undefined>(
      this.name,
      this.shape,
      this.metadata,
      true,
      this.isNullable,
    );
  }

  nullable(): ModelSchema<TShape, TOutput | null> {
    return new ModelSchema<TShape, TOutput | null>(
      this.name,
      this.shape,
      this.metadata,
      this.isOptional,
      true,
    );
  }

  /** Rename the model (used when deriving a new model via pick/omit/extend). */
  named(name: string): ModelSchema<TShape> {
    return new ModelSchema<TShape>(
      name,
      this.shape,
      this.metadata,
      this.isOptional,
      this.isNullable,
    );
  }

  pick<K extends keyof TShape & string>(
    ...keys: K[]
  ): ModelSchema<Pick<TShape, K>> {
    const nextShape = {} as ModelShape;
    for (const key of keys) {
      nextShape[key] = (this.shape as ModelShape)[key]!;
    }
    return new ModelSchema<Pick<TShape, K>>(
      this.name,
      nextShape as unknown as Pick<TShape, K>,
    );
  }

  omit<K extends keyof TShape & string>(
    ...keys: K[]
  ): ModelSchema<Omit<TShape, K>> {
    const nextShape = {} as ModelShape;
    for (const [k, v] of Object.entries(this.shape as ModelShape)) {
      if (!keys.includes(k as K)) nextShape[k] = v;
    }
    return new ModelSchema<Omit<TShape, K>>(
      this.name,
      nextShape as Omit<TShape, K>,
    );
  }

  partial(): ModelSchema<PartialShape<TShape>> {
    const nextShape = {} as ModelShape;
    for (const [k, v] of Object.entries(this.shape as ModelShape)) {
      nextShape[k] = v._asOptional(true);
    }
    return new ModelSchema<PartialShape<TShape>>(
      this.name,
      nextShape as unknown as PartialShape<TShape>,
    );
  }

  required(): ModelSchema<RequiredShape<TShape>> {
    const nextShape = {} as ModelShape;
    for (const [k, v] of Object.entries(this.shape as ModelShape)) {
      nextShape[k] = v._asOptional(false);
    }
    return new ModelSchema<RequiredShape<TShape>>(
      this.name,
      nextShape as unknown as RequiredShape<TShape>,
    );
  }

  extend<E extends ModelShape>(
    fields: E,
  ): ModelSchema<Omit<TShape, keyof E> & E> {
    const nextShape: ModelShape = { ...this.shape };
    for (const [k, v] of Object.entries(fields)) {
      nextShape[k] = v;
    }
    return new ModelSchema<Omit<TShape, keyof E> & E>(
      this.name,
      nextShape as Omit<TShape, keyof E> & E,
    );
  }

  merge<OShape extends ModelShape>(
    other: ModelSchema<OShape>,
  ): ModelSchema<Omit<TShape, keyof OShape> & OShape> {
    return this.extend(other.shape);
  }

  /** Returns the key of the field marked with `.identity()`, if any. */
  identityField(): string | undefined {
    for (const [k, v] of Object.entries(this.shape as ModelShape)) {
      if (v.metadata.isIdentity) return k;
    }
    return undefined;
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
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [fieldName, fieldSchema] of Object.entries(this.shape as ModelShape)) {
      const fieldPath = joinPath(path, fieldName);
      const fieldValue = fieldSchema._validateAt(input[fieldName], fieldPath, errors);
      if (fieldValue !== undefined || fieldName in input) {
        out[fieldName] = fieldValue;
      }
    }
    return out;
  }

  protected _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema {
    // Register in components if not present; emit a $ref.
    if (!ctx.components.has(this.name)) {
      // Placeholder to break recursion before we recurse into fields.
      ctx.components.set(this.name, {});
      ctx.components.set(this.name, this._buildInlineSchema(ctx));
    }
    return { $ref: `#/components/schemas/${this.name}` };
  }

  /** Build the inline OpenAPI schema (used both for component and inline emission). */
  _buildInlineSchema(ctx: OpenAPIContext): OpenAPISchema {
    const properties: Record<string, OpenAPISchema> = {};
    const required: string[] = [];
    for (const [fieldName, fieldSchema] of Object.entries(this.shape as ModelShape)) {
      properties[fieldName] = fieldSchema.toOpenAPI(ctx);
      if (!fieldSchema.isOptional && fieldSchema.metadata.default === undefined) {
        required.push(fieldName);
      }
    }
    const schema: OpenAPISchema = {
      type: 'object',
      title: this.name,
      properties,
    };
    if (required.length > 0) schema.required = required;
    return schema;
  }
}
