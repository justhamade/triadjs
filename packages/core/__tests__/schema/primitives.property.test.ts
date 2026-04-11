/**
 * Property-based tests for the primitive schema DSL.
 *
 * Each property asserts a UNIVERSAL invariant using `fast-check` to
 * generate hundreds of random inputs, including valid and invalid ones,
 * so we exercise both accept and reject paths.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '../../src/schema/index.js';
import { ValidationException } from '../../src/schema/types.js';

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

describe('StringSchema — properties', () => {
  it('accepts every string without throwing', () => {
    const schema = t.string();
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => schema.parse(input)).not.toThrow();
      }),
    );
  });

  it('rejects every non-string primitive', () => {
    const schema = t.string();
    const nonString = fc.oneof(
      fc.integer(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.array(fc.string()),
      fc.object(),
    );
    fc.assert(
      fc.property(nonString, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('minLength accepts iff length >= minLength', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(20), (input, min) => {
        const schema = t.string().minLength(min);
        const result = schema.validate(input);
        expect(result.success).toBe(input.length >= min);
      }),
    );
  });

  it('maxLength accepts iff length <= maxLength', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(20), (input, max) => {
        const schema = t.string().maxLength(max);
        const result = schema.validate(input);
        expect(result.success).toBe(input.length <= max);
      }),
    );
  });

  it('minLength + maxLength together accept iff within window', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.nat(10),
        fc.nat(10),
        (input, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const schema = t.string().minLength(min).maxLength(max);
          const result = schema.validate(input);
          expect(result.success).toBe(
            input.length >= min && input.length <= max,
          );
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Number kinds
// ---------------------------------------------------------------------------

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

describe('NumberSchema — properties', () => {
  it('int32 accepts any integer in [-2^31, 2^31-1]', () => {
    const schema = t.int32();
    fc.assert(
      fc.property(
        fc.integer({ min: INT32_MIN, max: INT32_MAX }),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('int32 rejects integers outside [-2^31, 2^31-1]', () => {
    const schema = t.int32();
    const outOfRange = fc.oneof(
      fc.integer({ min: INT32_MAX + 1, max: INT32_MAX + 1_000_000 }),
      fc.integer({ min: INT32_MIN - 1_000_000, max: INT32_MIN - 1 }),
    );
    fc.assert(
      fc.property(outOfRange, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('int32 rejects non-integer finite numbers', () => {
    const schema = t.int32();
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter(
          (n) => !Number.isInteger(n) && Number.isFinite(n),
        ),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('int64 rejects non-integer numbers', () => {
    const schema = t.int64();
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter(
          (n) => !Number.isInteger(n) && Number.isFinite(n),
        ),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('float64 accepts every finite number', () => {
    const schema = t.float64();
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('float64 rejects NaN and Infinity', () => {
    const schema = t.float64();
    const bad = fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    fc.assert(
      fc.property(bad, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('rejects every non-number primitive for every numeric kind', () => {
    const nonNumber = fc.oneof(
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.integer()),
      fc.object(),
    );
    const kinds = [t.int32(), t.int64(), t.float32(), t.float64()];
    fc.assert(
      fc.property(nonNumber, fc.nat(kinds.length - 1), (input, idx) => {
        const schema = kinds[idx]!;
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('min/max form an accept window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (a, b, value) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const schema = t.int32().min(min).max(max);
          const result = schema.validate(value);
          expect(result.success).toBe(value >= min && value <= max);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Boolean
// ---------------------------------------------------------------------------

describe('BooleanSchema — properties', () => {
  it('accepts true and false', () => {
    const schema = t.boolean();
    fc.assert(
      fc.property(fc.boolean(), (input) => {
        expect(() => schema.parse(input)).not.toThrow();
      }),
    );
  });

  it('rejects every non-boolean value', () => {
    const schema = t.boolean();
    const nonBool = fc.oneof(
      fc.integer(),
      fc.string(),
      fc.constant(null),
      fc.constantFrom(0, 1, 'true', 'false', ''),
      fc.array(fc.boolean()),
      fc.object(),
    );
    fc.assert(
      fc.property(nonBool, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Datetime
// ---------------------------------------------------------------------------

describe('DateTimeSchema — properties', () => {
  it('accepts well-formed ISO 8601 date-time strings', () => {
    const schema = t.datetime();
    // Constrain to the common era — `Date#toISOString` emits an extended
    // year format (`-000001-12-31T...`) for BCE dates, which is valid
    // ISO-8601 but not in Triad's accepted `YYYY-MM-DDT...` shape.
    const commonEraDate = fc
      .date({
        min: new Date('0001-01-01T00:00:00.000Z'),
        max: new Date('9999-12-31T23:59:59.999Z'),
      })
      .filter((d) => !Number.isNaN(d.getTime()));
    fc.assert(
      fc.property(commonEraDate, (d) => {
        const iso = d.toISOString();
        expect(() => schema.parse(iso)).not.toThrow();
      }),
    );
  });

  it('rejects arbitrary strings that are not ISO date-times', () => {
    const schema = t.datetime();
    // Strings that clearly don't start with YYYY-MM-DDT
    const bad = fc
      .string()
      .filter((s) => !/^\d{4}-\d{2}-\d{2}T/.test(s));
    fc.assert(
      fc.property(bad, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('rejects non-string values', () => {
    const schema = t.datetime();
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Literal
// ---------------------------------------------------------------------------

describe('LiteralSchema — properties', () => {
  it('accepts exactly the literal value for string literals', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (literal, input) => {
        const schema = t.literal(literal);
        const result = schema.validate(input);
        expect(result.success).toBe(input === literal);
      }),
    );
  });

  it('accepts exactly the literal value for number literals', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        (literal, input) => {
          const schema = t.literal(literal);
          const result = schema.validate(input);
          expect(result.success).toBe(input === literal);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown
// ---------------------------------------------------------------------------

describe('UnknownSchema — properties', () => {
  it('never throws for any defined, non-null input', () => {
    const schema = t.unknown();
    fc.assert(
      fc.property(
        fc.anything().filter((v) => v !== undefined && v !== null),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

describe('EmptySchema — properties', () => {
  it('accepts undefined only, rejects everything else', () => {
    const schema = t.empty();
    expect(() => schema.parse(undefined)).not.toThrow();
    fc.assert(
      fc.property(
        fc.anything().filter((v) => v !== undefined),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

describe('EnumSchema — properties', () => {
  it('accepts every declared value', () => {
    const values = ['dog', 'cat', 'bird', 'fish'] as const;
    const schema = t.enum(...values);
    fc.assert(
      fc.property(fc.constantFrom(...values), (input) => {
        expect(() => schema.parse(input)).not.toThrow();
      }),
    );
  });

  it('rejects strings not in the declared set', () => {
    const values = ['dog', 'cat', 'bird', 'fish'] as const;
    const schema = t.enum(...values);
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(values as readonly string[]).includes(s)),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('rejects non-string values', () => {
    const schema = t.enum('a', 'b', 'c');
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.array(fc.string())),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });
});
