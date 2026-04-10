/**
 * Foundation types for Triad's schema DSL.
 *
 * Every schema is a subclass of `SchemaNode<TOutput>` where `TOutput` is the
 * TypeScript type the schema produces when validated. Subclasses implement
 * `_validate` (runtime check) and `_toOpenAPI` (schema emission). The base
 * class provides the uniform developer-facing API: `.doc()`, `.example()`,
 * `.deprecated()`, `.default()`, `.identity()`, plus `validate()`, `parse()`,
 * and `toOpenAPI()`.
 *
 * All schema builders are immutable: every chainable method returns a new
 * instance via `_clone`.
 */

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface SchemaMetadata {
  description?: string;
  example?: unknown;
  deprecated?: boolean;
  default?: unknown;
  /** Marks the field as the identity of an entity (DDD). */
  isIdentity?: boolean;
  /** Override name used when emitting OpenAPI components (models only). */
  name?: string;
  /**
   * Storage hints consumed by storage adapters (e.g. `@triad/drizzle`).
   *
   * These are intentionally separate from validation metadata: they
   * describe how the value is *persisted*, not how it travels over the
   * API. Not emitted in OpenAPI — storage shape is an internal concern.
   */
  storage?: StorageMetadata;
}

/**
 * Storage-layer hints attached to a schema node.
 *
 * Adapters can read these from `node.metadata.storage` to map a Triad
 * schema to their own table-definition DSL. Triad itself does not act on
 * these hints — it just carries them so there is one source of truth for
 * "this field is the primary key", "this field is indexed", etc.
 */
export interface StorageMetadata {
  /** Override the column name (e.g. snake_case: `'user_id'`). */
  columnName?: string;
  /** Mark this field as the primary key. */
  primaryKey?: boolean;
  /** Enforce a unique constraint on this column. */
  unique?: boolean;
  /** Create a secondary index on this column. */
  indexed?: boolean;
  /** Default to the current timestamp at INSERT time. */
  defaultNow?: boolean;
  /** Default to a random UUID at INSERT time. */
  defaultRandom?: boolean;
  /** Foreign key reference in the form `'table.column'`. */
  references?: string;
  /** Free-form dialect-specific hints an adapter may consume. */
  custom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

export class ValidationException extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(
      `Validation failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  - ${e.path || '<root>'}: ${e.message}`).join('\n'),
    );
    this.name = 'ValidationException';
  }
}

/** Join a parent path with a child segment. */
export function joinPath(parent: string, child: string | number): string {
  if (parent === '') return typeof child === 'number' ? `[${child}]` : String(child);
  if (typeof child === 'number') return `${parent}[${child}]`;
  return `${parent}.${child}`;
}

// ---------------------------------------------------------------------------
// OpenAPI 3.1 schema subset
// ---------------------------------------------------------------------------

export interface OpenAPISchema {
  type?: string | string[];
  format?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  deprecated?: boolean;
  enum?: unknown[];
  const?: unknown;
  items?: OpenAPISchema;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  additionalProperties?: boolean | OpenAPISchema;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  prefixItems?: OpenAPISchema[];
  $ref?: string;
  title?: string;
  'x-triad-identity'?: string;
}

export interface OpenAPIContext {
  /** Accumulated named model components during conversion. */
  components: Map<string, OpenAPISchema>;
}

export function createOpenAPIContext(): OpenAPIContext {
  return { components: new Map() };
}

// ---------------------------------------------------------------------------
// SchemaNode base class
// ---------------------------------------------------------------------------

export abstract class SchemaNode<TOutput = unknown> {
  /** Phantom type used only for inference via `Infer<typeof schema>`. */
  declare readonly _output: TOutput;

  /** Discriminant string for runtime identification of the schema kind. */
  abstract readonly kind: string;

  constructor(
    public readonly metadata: Readonly<SchemaMetadata> = {},
    public readonly isOptional: boolean = false,
    public readonly isNullable: boolean = false,
  ) {}

  /**
   * Subclasses construct a new instance of themselves with updated base fields.
   * Subclass-specific state (e.g. string constraints, model shape) is copied
   * through by the subclass implementation.
   */
  protected abstract _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this;

  /** Subclass validation entry point — only called for non-null/non-undefined values. */
  protected abstract _validate(
    value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown;

  /** Subclass OpenAPI emission — metadata/nullability applied by the base class. */
  protected abstract _toOpenAPI(ctx: OpenAPIContext): OpenAPISchema;

  // -------------------------------------------------------------------------
  // Chainable metadata
  // -------------------------------------------------------------------------

  doc(description: string): this {
    return this._clone(
      { ...this.metadata, description },
      this.isOptional,
      this.isNullable,
    );
  }

  example(value: TOutput): this {
    return this._clone(
      { ...this.metadata, example: value },
      this.isOptional,
      this.isNullable,
    );
  }

  deprecated(isDeprecated = true): this {
    return this._clone(
      { ...this.metadata, deprecated: isDeprecated },
      this.isOptional,
      this.isNullable,
    );
  }

  default(value: TOutput): this {
    return this._clone(
      { ...this.metadata, default: value },
      this.isOptional,
      this.isNullable,
    );
  }

  /** Mark this field as the entity identity (DDD). */
  identity(isIdentity = true): this {
    return this._clone(
      { ...this.metadata, isIdentity },
      this.isOptional,
      this.isNullable,
    );
  }

  /**
   * Attach storage-layer metadata. Merges with any existing storage hints
   * so multiple `.storage({...})` calls accumulate rather than overwrite.
   * Consumed by storage adapters (`@triad/drizzle` and friends); ignored
   * by validation and OpenAPI emission.
   */
  storage(meta: StorageMetadata): this {
    return this._clone(
      {
        ...this.metadata,
        storage: { ...(this.metadata.storage ?? {}), ...meta },
      },
      this.isOptional,
      this.isNullable,
    );
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  validate(data: unknown): ValidationResult<TOutput> {
    const errors: ValidationError[] = [];
    const result = this._validateAt(data, '', errors);
    if (errors.length > 0) {
      return { success: false, errors };
    }
    return { success: true, data: result as TOutput };
  }

  parse(data: unknown): TOutput {
    const result = this.validate(data);
    if (!result.success) {
      throw new ValidationException(result.errors);
    }
    return result.data;
  }

  /**
   * Internal: produce a copy of this schema with the `isOptional` flag flipped.
   * Used by `ModelSchema.partial()` / `.required()`.
   */
  _asOptional(flag = true): this {
    return this._clone(this.metadata, flag, this.isNullable);
  }

  /**
   * Internal: validate at a specific path. Used by containers (models, arrays,
   * tuples, records, unions) so they can recurse with the correct path.
   */
  _validateAt(value: unknown, path: string, errors: ValidationError[]): unknown {
    let effective = value;
    if (effective === undefined && this.metadata.default !== undefined) {
      effective = this.metadata.default;
    }
    if (effective === undefined) {
      if (this.isOptional) return undefined;
      errors.push({ path, code: 'required', message: 'Value is required' });
      return undefined;
    }
    if (effective === null) {
      if (this.isNullable) return null;
      errors.push({ path, code: 'not_nullable', message: 'Value cannot be null' });
      return null;
    }
    return this._validate(effective, path, errors);
  }

  // -------------------------------------------------------------------------
  // OpenAPI
  // -------------------------------------------------------------------------

  toOpenAPI(ctx: OpenAPIContext = createOpenAPIContext()): OpenAPISchema {
    const inner = this._toOpenAPI(ctx);
    return this._applyMetadata(inner);
  }

  /** Apply shared metadata and nullability to a child OpenAPI schema. */
  protected _applyMetadata(inner: OpenAPISchema): OpenAPISchema {
    let out: OpenAPISchema = inner;

    // Nullable: in OpenAPI 3.1, represent null as a union type or oneOf for $ref.
    if (this.isNullable) {
      if (out.$ref !== undefined) {
        out = { oneOf: [{ $ref: out.$ref }, { type: 'null' }] };
      } else if (Array.isArray(out.type)) {
        if (!out.type.includes('null')) out = { ...out, type: [...out.type, 'null'] };
      } else if (typeof out.type === 'string') {
        out = { ...out, type: [out.type, 'null'] };
      } else {
        out = { ...out, oneOf: [...(out.oneOf ?? []), { type: 'null' }] };
      }
    }

    if (this.metadata.description !== undefined) out.description = this.metadata.description;
    if (this.metadata.example !== undefined) out.example = this.metadata.example;
    if (this.metadata.deprecated) out.deprecated = true;
    if (this.metadata.default !== undefined) out.default = this.metadata.default;
    if (this.metadata.isIdentity) out['x-triad-identity'] = 'true';

    return out;
  }
}

// ---------------------------------------------------------------------------
// Inference utility
// ---------------------------------------------------------------------------

/**
 * Extract the TypeScript output type of a schema.
 *
 * Uses conditional type inference (`infer U`) so that generic defaults with
 * references to earlier parameters (e.g. `TOutput = TValues[number]`) are
 * correctly substituted even when accessed through deep composition.
 */
export type Infer<T extends SchemaNode> = T extends SchemaNode<infer U> ? U : never;
