import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

/**
 * ISO 8601 date-time string. Output type is `string` (the validated raw value).
 * OpenAPI emission: `{ type: 'string', format: 'date-time' }`.
 */
export class DateTimeSchema<TOutput = string> extends SchemaNode<TOutput> {
  readonly kind = 'datetime';

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new DateTimeSchema<TOutput>(metadata, isOptional, isNullable) as this;
  }

  optional(): DateTimeSchema<TOutput | undefined> {
    return new DateTimeSchema<TOutput | undefined>(this.metadata, true, this.isNullable);
  }

  nullable(): DateTimeSchema<TOutput | null> {
    return new DateTimeSchema<TOutput | null>(this.metadata, this.isOptional, true);
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
        message: `Expected ISO 8601 date-time string, received ${typeof value}`,
      });
      return value;
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
      errors.push({
        path,
        code: 'invalid_datetime',
        message: 'String is not a valid ISO 8601 date-time',
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    return { type: 'string', format: 'date-time' };
  }
}
