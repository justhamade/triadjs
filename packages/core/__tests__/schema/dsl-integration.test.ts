import { describe, expect, it, expectTypeOf } from 'vitest';
import { t } from '../../src/schema/index.js';
import { createOpenAPIContext } from '../../src/schema/types.js';

/**
 * End-to-end test: build a Pet model via the `t` namespace exactly as the
 * Triad bootstrap spec shows, and verify construction + type inference +
 * validation + OpenAPI emission all work together.
 */
describe('DSL integration — petstore example from spec', () => {
  const Pet = t.model('Pet', {
    id: t.string().format('uuid').doc('Unique pet identifier').identity(),
    name: t.string().minLength(1).doc('Pet name').example('Buddy'),
    species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
    age: t.int32().min(0).max(100).doc('Age in years').example(3),
    status: t.enum('available', 'adopted', 'pending').doc('Adoption status').default('available'),
    tags: t.array(t.string()).doc('Searchable tags').optional(),
    createdAt: t.datetime().doc('Record creation timestamp'),
  });

  const CreatePet = Pet.pick('name', 'species', 'age', 'tags').named('CreatePet');

  const ApiError = t.model('ApiError', {
    code: t.string().doc('Machine-readable error code').example('NOT_FOUND'),
    message: t.string().doc('Human-readable error message'),
    details: t.record(t.string(), t.unknown()).optional(),
  });

  it('infers Pet type with optional tags', () => {
    type P = t.infer<typeof Pet>;
    expectTypeOf<P>().toMatchTypeOf<{
      id: string;
      name: string;
      species: 'dog' | 'cat' | 'bird' | 'fish';
      age: number;
      status: 'available' | 'adopted' | 'pending';
      createdAt: string;
      tags?: string[];
    }>();
  });

  it('validates a complete pet', () => {
    const result = Pet.validate({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Buddy',
      species: 'dog',
      age: 3,
      status: 'available',
      createdAt: '2026-04-10T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('CreatePet has only picked fields', () => {
    expect(Object.keys(CreatePet.shape).sort()).toEqual(['age', 'name', 'species', 'tags']);
    expect(CreatePet.name).toBe('CreatePet');
  });

  it('generates consistent OpenAPI with components', () => {
    const ctx = createOpenAPIContext();
    const petRef = Pet.toOpenAPI(ctx);
    const errRef = ApiError.toOpenAPI(ctx);

    expect(petRef).toEqual({ $ref: '#/components/schemas/Pet' });
    expect(errRef).toEqual({ $ref: '#/components/schemas/ApiError' });
    expect(ctx.components.size).toBe(2);

    const pet = ctx.components.get('Pet')!;
    expect(pet.properties?.species).toMatchObject({
      type: 'string',
      enum: ['dog', 'cat', 'bird', 'fish'],
    });
    expect(pet.properties?.age).toMatchObject({
      type: 'integer',
      format: 'int32',
      minimum: 0,
      maximum: 100,
    });
    // Default on status means it is not in required
    expect(pet.required).not.toContain('status');
    // tags is optional
    expect(pet.required).not.toContain('tags');
    // createdAt is required
    expect(pet.required).toContain('createdAt');
  });

  it('t.union produces oneOf', () => {
    const s = t.union(Pet, ApiError);
    const ctx = createOpenAPIContext();
    const schema = s.toOpenAPI(ctx);
    expect(schema.oneOf).toHaveLength(2);
  });

  it('t.tuple preserves tuple type', () => {
    const coords = t.tuple(t.float64(), t.float64());
    expectTypeOf<t.infer<typeof coords>>().toEqualTypeOf<[number, number]>();
    expect(coords.validate([1.5, 2.5]).success).toBe(true);
  });

  it('t.literal preserves literal type via const param', () => {
    const active = t.literal('active');
    expectTypeOf<t.infer<typeof active>>().toEqualTypeOf<'active'>();
  });
});
