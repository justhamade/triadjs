import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

/** Accepts any value; used for open-ended records and catch-alls. */
export class UnknownSchema extends SchemaNode<unknown> {
  readonly kind = 'unknown';

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new UnknownSchema(metadata, isOptional, isNullable) as this;
  }

  optional(): UnknownSchema {
    return new UnknownSchema(this.metadata, true, this.isNullable);
  }

  nullable(): UnknownSchema {
    return new UnknownSchema(this.metadata, this.isOptional, true);
  }

  protected _validate(
    value: unknown,
    _path: string,
    _errors: ValidationError[],
  ): unknown {
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    return {};
  }
}
