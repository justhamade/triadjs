/**
 * The `t.file()` schema primitive for multipart/form-data file uploads.
 *
 * A `FileSchema` represents a single uploaded file. At runtime the
 * validated value is a `TriadFile` object carrying the client-reported
 * metadata (name, mimeType, size) plus the file contents as a Node
 * `Buffer`. Adapters (Fastify, Express, Hono) are responsible for
 * parsing the incoming multipart body and producing `TriadFile`
 * instances before handing the body off to Triad's validation pipeline.
 *
 * The OpenAPI generator and every HTTP adapter use `hasFileFields` to
 * detect whether an endpoint's request body contains any file fields;
 * that determines whether to emit `multipart/form-data` content on the
 * spec side and whether to route through multipart parsing on the
 * adapter side.
 */

import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

// ---------------------------------------------------------------------------
// TriadFile runtime shape
// ---------------------------------------------------------------------------

/**
 * The value a `t.file()` field produces after validation. Adapters
 * normalize their native file representation (multer `File`, Fastify's
 * multipart part, Hono's `File`/`Blob`) into this common shape so user
 * handlers see the same type regardless of adapter.
 *
 * `mimeType` is taken straight from the client and MUST NOT be trusted
 * for security-sensitive decisions. For content-based checks, sniff
 * `buffer` yourself.
 */
export interface TriadFile {
  /** Original filename from the client. */
  readonly name: string;
  /** MIME type as reported by the client. NOT trusted. */
  readonly mimeType: string;
  /** Byte size. */
  readonly size: number;
  /** File contents as a Node Buffer. */
  readonly buffer: Buffer;
  /**
   * Streaming access to the file contents. Adapters that buffer the
   * entire file can construct this lazily from `buffer`; adapters that
   * stream may provide a native `ReadableStream`.
   */
  stream(): ReadableStream<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export interface FileConstraints {
  minSize?: number;
  maxSize?: number;
  mimeTypes?: readonly string[];
}

// ---------------------------------------------------------------------------
// Schema class
// ---------------------------------------------------------------------------

function isTriadFileLike(value: unknown): value is TriadFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['mimeType'] === 'string' &&
    typeof v['size'] === 'number' &&
    Buffer.isBuffer(v['buffer'])
  );
}

export class FileSchema extends SchemaNode<TriadFile> {
  readonly kind = 'file';

  constructor(
    metadata: SchemaMetadata = {},
    isOptional = false,
    isNullable = false,
    public readonly constraints: Readonly<FileConstraints> = {},
  ) {
    super(metadata, isOptional, isNullable);
  }

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new FileSchema(
      metadata,
      isOptional,
      isNullable,
      this.constraints,
    ) as this;
  }

  private _withConstraints(next: FileConstraints): FileSchema {
    return new FileSchema(
      this.metadata,
      this.isOptional,
      this.isNullable,
      { ...this.constraints, ...next },
    );
  }

  minSize(bytes: number): FileSchema {
    return this._withConstraints({ minSize: bytes });
  }

  maxSize(bytes: number): FileSchema {
    return this._withConstraints({ maxSize: bytes });
  }

  mimeTypes(...types: string[]): FileSchema {
    return this._withConstraints({ mimeTypes: types });
  }

  optional(): FileSchema {
    return new FileSchema(this.metadata, true, this.isNullable, this.constraints);
  }

  nullable(): FileSchema {
    return new FileSchema(this.metadata, this.isOptional, true, this.constraints);
  }

  protected _validate(
    value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown {
    if (!isTriadFileLike(value)) {
      errors.push({
        path,
        code: 'invalid_type',
        message: 'Expected an uploaded file',
      });
      return value;
    }
    const file = value;
    const { minSize, maxSize, mimeTypes } = this.constraints;
    if (maxSize !== undefined && file.size > maxSize) {
      errors.push({
        path,
        code: 'file_too_large',
        message: `File exceeds max size of ${maxSize} bytes (received ${file.size})`,
      });
    }
    if (minSize !== undefined && file.size < minSize) {
      errors.push({
        path,
        code: 'file_too_small',
        message: `File is below min size of ${minSize} bytes (received ${file.size})`,
      });
    }
    if (mimeTypes !== undefined && !mimeTypes.includes(file.mimeType)) {
      errors.push({
        path,
        code: 'invalid_mime_type',
        message: `File mime type "${file.mimeType}" is not in the allowed list [${mimeTypes.join(', ')}]`,
      });
    }
    return file;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    // The `__file` marker is consumed by the OpenAPI generator and
    // adapters to detect file-bearing schemas. It is stripped before
    // the final OpenAPI document is serialized.
    return {
      type: 'string',
      format: 'binary',
      __file: true,
    } as unknown as OpenAPISchema;
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function isFileSchema(schema: unknown): schema is FileSchema {
  return schema instanceof FileSchema;
}

/**
 * Recursively walk a schema tree and return true if any reachable node
 * is a `FileSchema`. Used by the OpenAPI generator to decide whether to
 * emit a `multipart/form-data` request body, and by every HTTP adapter
 * to decide whether to route the request through multipart parsing.
 */
export function hasFileFields(schema: unknown): boolean {
  if (!(schema instanceof SchemaNode)) return false;
  return walk(schema, new Set());
}

function walk(node: SchemaNode, seen: Set<SchemaNode>): boolean {
  if (seen.has(node)) return false;
  seen.add(node);

  if (node instanceof FileSchema) return true;

  // Avoid importing sibling modules (circular risk); inspect via
  // shape properties visible at runtime.
  const anyNode = node as unknown as {
    shape?: Record<string, SchemaNode>;
    item?: SchemaNode;
    valueSchema?: SchemaNode;
    options?: readonly SchemaNode[];
    items?: readonly SchemaNode[];
  };

  if (anyNode.shape) {
    for (const child of Object.values(anyNode.shape)) {
      if (walk(child, seen)) return true;
    }
  }
  if (anyNode.item instanceof SchemaNode) {
    if (walk(anyNode.item, seen)) return true;
  }
  if (anyNode.valueSchema instanceof SchemaNode) {
    if (walk(anyNode.valueSchema, seen)) return true;
  }
  if (Array.isArray(anyNode.options)) {
    for (const opt of anyNode.options) {
      if (walk(opt, seen)) return true;
    }
  }
  if (Array.isArray(anyNode.items)) {
    for (const it of anyNode.items) {
      if (walk(it, seen)) return true;
    }
  }
  return false;
}
