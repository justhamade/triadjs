import { describe, expect, it, expectTypeOf } from 'vitest';
import { t } from '../../src/schema/index.js';
import { createOpenAPIContext } from '../../src/schema/types.js';
import type { Infer } from '../../src/schema/types.js';

// Use `t.*` factories (with `const` generic parameters) rather than
// `new EnumSchema(...)`. Bare class constructors get their generics widened by
// contextual typing when nested inside a ModelSchema literal; the factories
// preserve literal inference via their `const` type parameters.
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
  tags: t.array(t.string()).optional(),
});

describe('ModelSchema — construction and inference', () => {
  it('infers required and optional fields', () => {
    type P = Infer<typeof Pet>;
    expectTypeOf<P>().toEqualTypeOf<{
      id: string;
      name: string;
      species: 'dog' | 'cat' | 'bird' | 'fish';
      age: number;
      tags?: string[];
    }>();
  });

  it('carries the model name', () => {
    expect(Pet.name).toBe('Pet');
  });

  it('identityField returns the field marked with .identity()', () => {
    expect(Pet.identityField()).toBe('id');
  });
});

describe('ModelSchema — validation', () => {
  it('accepts a valid pet', () => {
    const r = Pet.validate({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Buddy',
      species: 'dog',
      age: 3,
    });
    expect(r.success).toBe(true);
  });

  it('reports missing required fields with paths', () => {
    const r = Pet.validate({
      id: '550e8400-e29b-41d4-a716-446655440000',
      species: 'dog',
      age: 3,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.path === 'name' && e.code === 'required')).toBe(true);
    }
  });

  it('reports nested field errors with dot paths', () => {
    const r = Pet.validate({
      id: 'not-a-uuid',
      name: 'Buddy',
      species: 'dog',
      age: 200,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const codes = r.errors.map((e) => `${e.path}:${e.code}`);
      expect(codes).toContain('id:format');
      expect(codes).toContain('age:max');
    }
  });

  it('allows missing optional fields', () => {
    const r = Pet.validate({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Buddy',
      species: 'dog',
      age: 3,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(Pet.validate('not an object').success).toBe(false);
    expect(Pet.validate(null).success).toBe(false);
    expect(Pet.validate([]).success).toBe(false);
  });
});

describe('ModelSchema — composition', () => {
  it('pick() keeps only selected fields', () => {
    const CreatePet = Pet.pick('name', 'species', 'age');
    type C = Infer<typeof CreatePet>;
    expectTypeOf<C>().toEqualTypeOf<{
      name: string;
      species: 'dog' | 'cat' | 'bird' | 'fish';
      age: number;
    }>();
    expect(Object.keys(CreatePet.shape).sort()).toEqual(['age', 'name', 'species']);
  });

  it('omit() drops selected fields', () => {
    const NoTags = Pet.omit('tags');
    expect('tags' in NoTags.shape).toBe(false);
    expect('id' in NoTags.shape).toBe(true);
  });

  it('partial() makes all fields optional', () => {
    const UpdatePet = Pet.pick('name', 'age').partial();
    const r = UpdatePet.validate({});
    expect(r.success).toBe(true);
  });

  it('extend() adds new fields', () => {
    const PetWithOwner = Pet.extend({ ownerId: t.string().format('uuid') });
    expect('ownerId' in PetWithOwner.shape).toBe(true);
    type PWO = Infer<typeof PetWithOwner>;
    expectTypeOf<PWO>().toMatchTypeOf<{ ownerId: string }>();
  });

  it('named() renames the model', () => {
    const CreatePet = Pet.pick('name', 'species').named('CreatePet');
    expect(CreatePet.name).toBe('CreatePet');
  });

  it('composition does not mutate the original', () => {
    const CreatePet = Pet.pick('name');
    expect(Object.keys(Pet.shape).length).toBeGreaterThan(1);
    expect(Object.keys(CreatePet.shape).length).toBe(1);
  });
});

describe('ModelSchema — OpenAPI output', () => {
  it('emits a $ref and registers the component', () => {
    const ctx = createOpenAPIContext();
    const ref = Pet.toOpenAPI(ctx);
    expect(ref).toEqual({ $ref: '#/components/schemas/Pet' });
    expect(ctx.components.has('Pet')).toBe(true);
  });

  it('component has correct properties and required list', () => {
    const ctx = createOpenAPIContext();
    Pet.toOpenAPI(ctx);
    const component = ctx.components.get('Pet')!;
    expect(component.type).toBe('object');
    expect(component.title).toBe('Pet');
    expect(component.required?.sort()).toEqual(['age', 'id', 'name', 'species']);
    expect(component.properties?.id).toMatchObject({
      type: 'string',
      format: 'uuid',
      'x-triad-identity': 'true',
    });
  });

  it('does not include optional fields in required', () => {
    const ctx = createOpenAPIContext();
    Pet.toOpenAPI(ctx);
    const component = ctx.components.get('Pet')!;
    expect(component.required).not.toContain('tags');
  });
});

describe('ValueSchema', () => {
  it('wraps a single primitive schema', () => {
    const Email = t.value('Email', t.string().format('email'));
    expect(Email.validate('alice@example.com').success).toBe(true);
    expect(Email.validate('not-an-email').success).toBe(false);
    expectTypeOf<Infer<typeof Email>>().toEqualTypeOf<string>();
  });

  it('composes multiple fields', () => {
    const Money = t.value('Money', {
      amount: t.float64().min(0),
      currency: t.enum('USD', 'CAD', 'EUR'),
    });
    expect(Money.validate({ amount: 9.99, currency: 'USD' }).success).toBe(true);
    expect(Money.validate({ amount: -1, currency: 'USD' }).success).toBe(false);
    expect(Money.validate({ amount: 9.99, currency: 'XYZ' }).success).toBe(false);

    type M = Infer<typeof Money>;
    expectTypeOf<M>().toMatchTypeOf<{ amount: number; currency: 'USD' | 'CAD' | 'EUR' }>();
  });

  it('emits inline OpenAPI (not $ref)', () => {
    const Email = t.value('Email', t.string().format('email'));
    const schema = Email.toOpenAPI();
    expect(schema.$ref).toBeUndefined();
    expect(schema).toMatchObject({ type: 'string', format: 'email', title: 'Email' });
  });

  it('emits inline object for composite value', () => {
    const Money = t.value('Money', {
      amount: t.float64(),
      currency: t.string(),
    });
    const schema = Money.toOpenAPI();
    expect(schema.$ref).toBeUndefined();
    expect(schema).toMatchObject({
      type: 'object',
      title: 'Money',
      properties: {
        amount: { type: 'number', format: 'double' },
        currency: { type: 'string' },
      },
      required: ['amount', 'currency'],
    });
  });
});
