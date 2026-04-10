import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

export const STRING_FORMATS = [
  'uuid',
  'email',
  'uri',
  'url',
  'hostname',
  'ipv4',
  'ipv6',
  'date',
  'date-time',
  'time',
  'duration',
  'byte',
  'binary',
  'password',
  'regex',
] as const;

export type StringFormat = (typeof STRING_FORMATS)[number];

interface StringConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  format?: StringFormat;
}

export class StringSchema<TOutput = string> extends SchemaNode<TOutput> {
  readonly kind = 'string';

  constructor(
    metadata: SchemaMetadata = {},
    isOptional = false,
    isNullable = false,
    public readonly constraints: Readonly<StringConstraints> = {},
  ) {
    super(metadata, isOptional, isNullable);
  }

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new StringSchema<TOutput>(
      metadata,
      isOptional,
      isNullable,
      this.constraints,
    ) as this;
  }

  private _withConstraints(next: StringConstraints): StringSchema<TOutput> {
    return new StringSchema<TOutput>(
      this.metadata,
      this.isOptional,
      this.isNullable,
      { ...this.constraints, ...next },
    );
  }

  minLength(n: number): StringSchema<TOutput> {
    return this._withConstraints({ minLength: n });
  }

  maxLength(n: number): StringSchema<TOutput> {
    return this._withConstraints({ maxLength: n });
  }

  pattern(re: RegExp): StringSchema<TOutput> {
    return this._withConstraints({ pattern: re });
  }

  format(fmt: StringFormat): StringSchema<TOutput> {
    return this._withConstraints({ format: fmt });
  }

  optional(): StringSchema<TOutput | undefined> {
    return new StringSchema<TOutput | undefined>(
      this.metadata,
      true,
      this.isNullable,
      this.constraints,
    );
  }

  nullable(): StringSchema<TOutput | null> {
    return new StringSchema<TOutput | null>(
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
    if (typeof value !== 'string') {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected string, received ${typeOf(value)}`,
      });
      return value;
    }
    const { minLength, maxLength, pattern, format } = this.constraints;
    if (minLength !== undefined && value.length < minLength) {
      errors.push({
        path,
        code: 'min_length',
        message: `String must be at least ${minLength} characters (received ${value.length})`,
      });
    }
    if (maxLength !== undefined && value.length > maxLength) {
      errors.push({
        path,
        code: 'max_length',
        message: `String must be at most ${maxLength} characters (received ${value.length})`,
      });
    }
    if (pattern !== undefined && !pattern.test(value)) {
      errors.push({
        path,
        code: 'pattern',
        message: `String does not match pattern ${pattern.source}`,
      });
    }
    if (format !== undefined && !validateFormat(format, value)) {
      errors.push({
        path,
        code: 'format',
        message: `String is not a valid ${format}`,
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    const schema: OpenAPISchema = { type: 'string' };
    const { minLength, maxLength, pattern, format } = this.constraints;
    if (minLength !== undefined) schema.minLength = minLength;
    if (maxLength !== undefined) schema.maxLength = maxLength;
    if (pattern !== undefined) schema.pattern = pattern.source;
    if (format !== undefined) schema.format = format;
    return schema;
  }
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const FORMAT_VALIDATORS: Record<StringFormat, (v: string) => boolean> = {
  uuid: (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    ) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  uri: (v) => tryURL(v),
  url: (v) => tryURL(v),
  hostname: (v) =>
    v.length <= 253 &&
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
      v,
    ),
  ipv4: (v) => {
    const parts = v.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
  },
  ipv6: (v) => /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|::|(([0-9a-f]{1,4}:)*)?(:([0-9a-f]{1,4}:?)*)?)$/i.test(v),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  'date-time': (v) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)),
  time: (v) => /^\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(v),
  duration: (v) => /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(v),
  byte: (v) => /^[A-Za-z0-9+/]*={0,2}$/.test(v),
  binary: () => true,
  password: () => true,
  regex: (v) => {
    try {
      new RegExp(v);
      return true;
    } catch {
      return false;
    }
  },
};

function tryURL(v: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

function validateFormat(format: StringFormat, value: string): boolean {
  return FORMAT_VALIDATORS[format](value);
}
