/**
 * Property-based tests for collection schemas: arrays, records, tuples,
 * unions.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '../../src/schema/index.js';
import { ValidationException } from '../../src/schema/types.js';

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

describe('ArraySchema — properties', () => {
  it('accepts any array whose elements all match the inner schema', () => {
    const schema = t.array(t.int32());
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 })),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('rejects arrays containing any element that fails the inner schema', () => {
    const schema = t.array(t.int32());
    // At least one non-integer value is required for the rejection path.
    const mixed = fc
      .array(fc.oneof(fc.integer(), fc.string(), fc.boolean()))
      .filter((arr) =>
        arr.some((v) => typeof v !== 'number' || !Number.isInteger(v)),
      );
    fc.assert(
      fc.property(mixed, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });

  it('rejects non-array inputs', () => {
    const schema = t.array(t.string());
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.object()),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('minItems/maxItems form an accept window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 20 }),
        fc.nat(10),
        fc.nat(10),
        (input, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const schema = t.array(t.int32()).minItems(min).maxItems(max);
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
// Record
// ---------------------------------------------------------------------------

describe('RecordSchema — properties', () => {
  it('accepts plain objects where every value matches the value schema', () => {
    const schema = t.record(t.string(), t.int32());
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.integer({ min: -100, max: 100 })),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('rejects arrays and nulls', () => {
    const schema = t.record(t.string(), t.int32());
    fc.assert(
      fc.property(
        fc.oneof(fc.array(fc.integer()), fc.constant(null), fc.string()),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('rejects objects with a value that fails the value schema', () => {
    const schema = t.record(t.string(), t.int32());
    const bad = fc
      .dictionary(fc.string(), fc.oneof(fc.integer(), fc.string()))
      .filter((o) =>
        Object.values(o).some((v) => typeof v !== 'number'),
      );
    fc.assert(
      fc.property(bad, (input) => {
        expect(() => schema.parse(input)).toThrow(ValidationException);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tuple
// ---------------------------------------------------------------------------

describe('TupleSchema — properties', () => {
  it('rejects arrays of the wrong length', () => {
    const schema = t.tuple(t.string(), t.int32(), t.boolean());
    fc.assert(
      fc.property(
        fc.array(fc.anything()).filter((a) => a.length !== 3),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('accepts arrays of the correct length with matching element types', () => {
    const schema = t.tuple(t.string(), t.int32(), t.boolean());
    fc.assert(
      fc.property(
        fc.tuple(fc.string(), fc.integer({ min: -1000, max: 1000 }), fc.boolean()),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('rejects non-array inputs', () => {
    const schema = t.tuple(t.string(), t.string());
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.object()),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

describe('UnionSchema — properties', () => {
  it('accepts any input matching at least one option', () => {
    const schema = t.union(t.string(), t.int32());
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer({ min: -1000, max: 1000 })),
        (input) => {
          expect(() => schema.parse(input)).not.toThrow();
        },
      ),
    );
  });

  it('rejects inputs that match no option', () => {
    const schema = t.union(t.string(), t.int32());
    fc.assert(
      fc.property(
        fc.oneof(fc.boolean(), fc.array(fc.integer()), fc.object()),
        (input) => {
          expect(() => schema.parse(input)).toThrow(ValidationException);
        },
      ),
    );
  });

  it('parses through the first matching branch (order matters semantically)', () => {
    const schema = t.union(t.literal('a'), t.literal('b'));
    fc.assert(
      fc.property(fc.constantFrom('a', 'b'), (input) => {
        expect(schema.parse(input)).toBe(input);
      }),
    );
  });
});
