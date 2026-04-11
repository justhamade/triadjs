/**
 * The "no body" schema primitive.
 *
 * Unlike `t.unknown().optional()`, `t.empty()` is a distinct kind that
 * downstream generators and adapters inspect to emit correct HTTP
 * semantics:
 *
 *   - OpenAPI: the response object omits the `content` field entirely.
 *   - Adapters (Express/Fastify/Hono): the response is sent without a
 *     body *and* without a `Content-Type: application/json` header.
 *   - `ctx.respond[status]` becomes a zero-argument function so handlers
 *     for 204/205/304 do not need to pass `undefined`.
 *
 * Use this for any HTTP status code that is defined to have no message
 * body — 204 No Content, 205 Reset Content, 304 Not Modified.
 */

import {
  SchemaNode,
  ValidationException,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

/**
 * A schema representing the explicit absence of a response body.
 *
 * `parse(undefined)` succeeds and returns `undefined`. Anything else
 * (including `null`, `{}`, `''`) is rejected so handlers that accidentally
 * send a body still surface as a bug.
 */
export class EmptySchema extends SchemaNode<void> {
  readonly kind = 'empty';

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new EmptySchema(metadata, isOptional, isNullable) as this;
  }

  /**
   * Override the base class validation gate: `t.empty()` must accept
   * `undefined` as its success case, which the base gate would otherwise
   * reject as "required".
   */
  override _validateAt(
    value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown {
    if (value === undefined) return undefined;
    errors.push({
      path,
      code: 'empty_body_expected',
      message: 'Empty response expected no body',
    });
    return undefined;
  }

  protected _validate(
    _value: unknown,
    path: string,
    errors: ValidationError[],
  ): unknown {
    errors.push({
      path,
      code: 'empty_body_expected',
      message: 'Empty response expected no body',
    });
    return undefined;
  }

  override parse(data: unknown): void {
    const result = this.validate(data);
    if (!result.success) {
      throw new ValidationException(result.errors);
    }
    return undefined;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    // Marker consumed by the OpenAPI generator to omit the `content`
    // field. The marker itself is never serialized into the final
    // OpenAPI document.
    return { 'x-triad-empty': true } as unknown as OpenAPISchema;
  }
}

/**
 * Type guard used by the OpenAPI generator, every HTTP adapter, and the
 * test runner to detect empty-body schemas in a uniform way.
 */
export function isEmptySchema(schema: unknown): schema is EmptySchema {
  return schema instanceof EmptySchema;
}
