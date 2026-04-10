import {
  SchemaNode,
  type SchemaMetadata,
  type ValidationError,
  type OpenAPIContext,
  type OpenAPISchema,
} from './types.js';

export type NumberType = 'int32' | 'int64' | 'float32' | 'float64';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

interface NumberConstraints {
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  multipleOf?: number;
}

export class NumberSchema<TOutput = number> extends SchemaNode<TOutput> {
  readonly kind = 'number';

  constructor(
    public readonly numberType: NumberType,
    metadata: SchemaMetadata = {},
    isOptional = false,
    isNullable = false,
    public readonly constraints: Readonly<NumberConstraints> = {},
  ) {
    super(metadata, isOptional, isNullable);
  }

  protected _clone(
    metadata: SchemaMetadata,
    isOptional: boolean,
    isNullable: boolean,
  ): this {
    return new NumberSchema<TOutput>(
      this.numberType,
      metadata,
      isOptional,
      isNullable,
      this.constraints,
    ) as this;
  }

  private _withConstraints(next: NumberConstraints): NumberSchema<TOutput> {
    return new NumberSchema<TOutput>(
      this.numberType,
      this.metadata,
      this.isOptional,
      this.isNullable,
      { ...this.constraints, ...next },
    );
  }

  min(n: number): NumberSchema<TOutput> {
    return this._withConstraints({ min: n });
  }

  max(n: number): NumberSchema<TOutput> {
    return this._withConstraints({ max: n });
  }

  exclusiveMin(n: number): NumberSchema<TOutput> {
    return this._withConstraints({ exclusiveMin: n });
  }

  exclusiveMax(n: number): NumberSchema<TOutput> {
    return this._withConstraints({ exclusiveMax: n });
  }

  multipleOf(n: number): NumberSchema<TOutput> {
    return this._withConstraints({ multipleOf: n });
  }

  optional(): NumberSchema<TOutput | undefined> {
    return new NumberSchema<TOutput | undefined>(
      this.numberType,
      this.metadata,
      true,
      this.isNullable,
      this.constraints,
    );
  }

  nullable(): NumberSchema<TOutput | null> {
    return new NumberSchema<TOutput | null>(
      this.numberType,
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
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({
        path,
        code: 'invalid_type',
        message: `Expected ${this.numberType}, received ${describe(value)}`,
      });
      return value;
    }
    if (!Number.isFinite(value)) {
      errors.push({
        path,
        code: 'not_finite',
        message: 'Number must be finite',
      });
      return value;
    }
    if (this.numberType === 'int32' || this.numberType === 'int64') {
      if (!Number.isInteger(value)) {
        errors.push({
          path,
          code: 'not_integer',
          message: `${this.numberType} must be an integer`,
        });
      }
      if (this.numberType === 'int32' && (value < INT32_MIN || value > INT32_MAX)) {
        errors.push({
          path,
          code: 'out_of_range',
          message: `int32 out of range [-2^31, 2^31 - 1]`,
        });
      }
      if (this.numberType === 'int64' && !Number.isSafeInteger(value)) {
        errors.push({
          path,
          code: 'out_of_range',
          message: 'int64 exceeds JS safe integer range',
        });
      }
    }
    const { min, max, exclusiveMin, exclusiveMax, multipleOf } = this.constraints;
    if (min !== undefined && value < min) {
      errors.push({ path, code: 'min', message: `Must be >= ${min}` });
    }
    if (max !== undefined && value > max) {
      errors.push({ path, code: 'max', message: `Must be <= ${max}` });
    }
    if (exclusiveMin !== undefined && value <= exclusiveMin) {
      errors.push({ path, code: 'exclusive_min', message: `Must be > ${exclusiveMin}` });
    }
    if (exclusiveMax !== undefined && value >= exclusiveMax) {
      errors.push({ path, code: 'exclusive_max', message: `Must be < ${exclusiveMax}` });
    }
    if (multipleOf !== undefined && value % multipleOf !== 0) {
      errors.push({
        path,
        code: 'multiple_of',
        message: `Must be a multiple of ${multipleOf}`,
      });
    }
    return value;
  }

  protected _toOpenAPI(_ctx: OpenAPIContext): OpenAPISchema {
    const schema: OpenAPISchema = {
      type: isInt(this.numberType) ? 'integer' : 'number',
      format: this.numberType === 'float64' ? 'double' : this.numberType === 'float32' ? 'float' : this.numberType,
    };
    const { min, max, exclusiveMin, exclusiveMax, multipleOf } = this.constraints;
    if (min !== undefined) schema.minimum = min;
    if (max !== undefined) schema.maximum = max;
    if (exclusiveMin !== undefined) schema.exclusiveMinimum = exclusiveMin;
    if (exclusiveMax !== undefined) schema.exclusiveMaximum = exclusiveMax;
    if (multipleOf !== undefined) schema.multipleOf = multipleOf;
    return schema;
  }
}

function isInt(t: NumberType): boolean {
  return t === 'int32' || t === 'int64';
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Number.isNaN(v)) return 'NaN';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
