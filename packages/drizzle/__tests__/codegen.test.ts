import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, scenario, t } from '@triad/core';
import {
  generateDrizzleSchema,
  walkRouter,
  emitSqlite,
  emitPostgres,
  emitMysql,
  CodegenError,
} from '../src/index.js';
import { toSnakeCase } from '../src/codegen/walker.js';

// ---------------------------------------------------------------------------
// toSnakeCase helper
// ---------------------------------------------------------------------------

describe('toSnakeCase', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnakeCase('adoptionFeeAmount')).toBe('adoption_fee_amount');
    expect(toSnakeCase('userId')).toBe('user_id');
    expect(toSnakeCase('name')).toBe('name');
  });

  it('handles digits', () => {
    expect(toSnakeCase('field2Value')).toBe('field2_value');
  });

  it('leaves already-snake_case alone', () => {
    expect(toSnakeCase('already_snake')).toBe('already_snake');
  });
});

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

describe('walkRouter', () => {
  function tableRouterFor(...endpoints: ReturnType<typeof endpoint>[]) {
    const router = createRouter({ title: 'x', version: '1' });
    router.add(...endpoints);
    return router;
  }

  it('picks up models with a primaryKey-tagged field', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
    });
    const listPets = endpoint({
      name: 'listPets',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: t.array(Pet), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]([]),
    });
    const tables = walkRouter(tableRouterFor(listPets));
    expect(tables).toHaveLength(1);
    expect(tables[0]?.modelName).toBe('Pet');
    expect(tables[0]?.tableName).toBe('pets');
    expect(tables[0]?.identifier).toBe('pets');
  });

  it('ignores models without primaryKey fields (ApiError, CreatePet, etc.)', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
    });
    const CreatePet = Pet.pick('name').named('CreatePet');
    const ApiError = t.model('ApiError', {
      code: t.string(),
      message: t.string(),
    });
    const createPet = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'x',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Invalid' },
      },
      handler: async (ctx) =>
        ctx.respond[201]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: ctx.body.name,
        }),
    });
    const tables = walkRouter(tableRouterFor(createPet));
    const names = tables.map((t) => t.modelName);
    expect(names).toEqual(['Pet']);
    expect(names).not.toContain('CreatePet');
    expect(names).not.toContain('ApiError');
  });

  it('maps Triad schema kinds to logical column types', () => {
    const Thing = t.model('Thing', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      age: t.int32(),
      bignum: t.int64(),
      price: t.float64(),
      speed: t.float32(),
      active: t.boolean(),
      createdAt: t.datetime(),
      tags: t.array(t.string()),
    });
    const ep = endpoint({
      name: 'getThing',
      method: 'GET',
      path: '/things/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Thing, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const columns = tables[0]?.columns ?? [];
    const byField = new Map(columns.map((c) => [c.fieldName, c]));
    // String with format('uuid') becomes the 'uuid' logical type so
    // Postgres emitters can use a real uuid column.
    expect(byField.get('id')?.logicalType).toBe('uuid');
    expect(byField.get('id')?.primaryKey).toBe(true);
    expect(byField.get('age')?.logicalType).toBe('integer');
    expect(byField.get('bignum')?.logicalType).toBe('bigint');
    expect(byField.get('price')?.logicalType).toBe('double');
    expect(byField.get('speed')?.logicalType).toBe('float');
    expect(byField.get('active')?.logicalType).toBe('boolean');
    expect(byField.get('createdAt')?.logicalType).toBe('datetime');
    expect(byField.get('createdAt')?.columnName).toBe('created_at');
    expect(byField.get('tags')?.logicalType).toBe('json');
  });

  it('captures enum values in the descriptor', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      species: t.enum('dog', 'cat', 'bird', 'fish'),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const speciesCol = tables[0]?.columns.find((c) => c.fieldName === 'species');
    expect(speciesCol?.enumValues).toEqual(['dog', 'cat', 'bird', 'fish']);
  });

  it('flattens a multi-field value object into prefixed columns', () => {
    const Money = t.value('Money', {
      amount: t.int32().min(0),
      currency: t.enum('USD', 'CAD', 'EUR'),
    });
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      adoptionFee: Money,
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const names = tables[0]?.columns.map((c) => c.columnName) ?? [];
    expect(names).toContain('adoption_fee_amount');
    expect(names).toContain('adoption_fee_currency');
    const amount = tables[0]?.columns.find(
      (c) => c.fieldName === 'adoptionFeeAmount',
    );
    expect(amount?.logicalType).toBe('integer');
    const currency = tables[0]?.columns.find(
      (c) => c.fieldName === 'adoptionFeeCurrency',
    );
    expect(currency?.enumValues).toEqual(['USD', 'CAD', 'EUR']);
  });

  it('flattens a single-schema value object into one column', () => {
    const Email = t.value('Email', t.string().format('email'));
    const User = t.model('User', {
      id: t.string().storage({ primaryKey: true }),
      contactEmail: Email,
    });
    const ep = endpoint({
      name: 'getUser',
      method: 'GET',
      path: '/users/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: User, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const email = tables[0]?.columns.find((c) => c.fieldName === 'contactEmail');
    expect(email?.columnName).toBe('contact_email');
    expect(email?.logicalType).toBe('string');
  });

  it('reads storage hints for defaults and references', () => {
    const Adoption = t.model('Adoption', {
      id: t
        .string()
        .format('uuid')
        .storage({ primaryKey: true, defaultRandom: true }),
      petId: t.string().storage({ references: 'pets.id' }),
      requestedAt: t.datetime().storage({ defaultNow: true }),
    });
    const ep = endpoint({
      name: 'getAdoption',
      method: 'GET',
      path: '/adoptions/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Adoption, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const cols = tables[0]?.columns ?? [];
    const id = cols.find((c) => c.fieldName === 'id');
    expect(id?.default).toEqual({ kind: 'random' });
    const petId = cols.find((c) => c.fieldName === 'petId');
    expect(petId?.references).toBe('pets.id');
    const requestedAt = cols.find((c) => c.fieldName === 'requestedAt');
    expect(requestedAt?.default).toEqual({ kind: 'now' });
  });

  it('marks optional fields as nullable (notNull=false)', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      name: t.string(),
      nickname: t.string().optional(),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const tables = walkRouter(tableRouterFor(ep));
    const cols = tables[0]?.columns ?? [];
    expect(cols.find((c) => c.fieldName === 'name')?.notNull).toBe(true);
    expect(cols.find((c) => c.fieldName === 'nickname')?.notNull).toBe(false);
  });

  it('throws a helpful error for nested model fields', () => {
    const Owner = t.model('Owner', {
      id: t.string().storage({ primaryKey: true }),
    });
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      owner: Owner, // nested model field — not auto-translatable
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    expect(() => walkRouter(tableRouterFor(ep))).toThrow(CodegenError);
    expect(() => walkRouter(tableRouterFor(ep))).toThrow(/nested models/i);
  });
});

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

describe('emitSqlite', () => {
  it('produces valid TypeScript with header, imports, and tables', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string().minLength(1),
      species: t.enum('dog', 'cat'),
      age: t.int32().min(0),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const source = emitSqlite(walkRouter(router));

    // Header
    expect(source).toContain('Generated by `triad db generate`');
    expect(source).toContain('Do not edit by hand');

    // Imports — only the helpers we actually use, sorted alphabetically
    // after the table helper.
    expect(source).toContain(
      `import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';`,
    );
    expect(source).not.toContain('real');
    expect(source).not.toContain('blob');

    // Table
    expect(source).toContain(`export const pets = sqliteTable('pets', {`);
    expect(source).toContain(`id: text('id').notNull().primaryKey()`);
    expect(source).toContain(`name: text('name').notNull()`);
    expect(source).toContain(
      `species: text('species', { enum: ['dog', 'cat'] }).notNull()`,
    );
    expect(source).toContain(`age: integer('age').notNull()`);
    expect(source).toContain('});');
  });

  it('emits references() for foreign keys', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
    });
    const Adoption = t.model('Adoption', {
      id: t.string().storage({ primaryKey: true }),
      petId: t.string().storage({ references: 'pets.id' }),
    });
    const ep1 = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const ep2 = endpoint({
      name: 'getAdoption',
      method: 'GET',
      path: '/adoptions/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Adoption, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);
    const source = emitSqlite(walkRouter(router));

    expect(source).toContain(
      `petId: text('pet_id').references(() => pets.id).notNull()`,
    );
  });

  it('emits $defaultFn for defaultNow and defaultRandom', () => {
    const Pet = t.model('Pet', {
      id: t
        .string()
        .storage({ primaryKey: true, defaultRandom: true }),
      createdAt: t.datetime().storage({ defaultNow: true }),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const source = emitSqlite(walkRouter(router));

    expect(source).toContain('$defaultFn(() => crypto.randomUUID())');
    expect(source).toContain('$defaultFn(() => new Date().toISOString())');
  });

  it('emits literal .default() for Triad defaults', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      status: t
        .enum('available', 'adopted', 'pending')
        .default('available'),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const source = emitSqlite(walkRouter(router));
    expect(source).toContain(`.default('available')`);
  });
});

// ---------------------------------------------------------------------------
// Postgres emitter
// ---------------------------------------------------------------------------

describe('emitPostgres', () => {
  function singleTableRouter() {
    const Pet = t.model('Pet', {
      id: t
        .string()
        .format('uuid')
        .storage({ primaryKey: true, defaultRandom: true }),
      name: t.string().minLength(1),
      species: t.enum('dog', 'cat', 'bird', 'fish'),
      age: t.int32().min(0),
      visits: t.int64(),
      temperature: t.float64(),
      isFriendly: t.boolean(),
      metadata: t.record(t.string(), t.unknown()).optional(),
      tags: t.array(t.string()).optional(),
      createdAt: t.datetime().storage({ defaultNow: true }),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    return router;
  }

  it('imports from drizzle-orm/pg-core and uses pgTable', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    // Column helpers are sorted alphabetically after the table helper.
    expect(source).toContain(
      `import { pgTable, bigint, boolean, doublePrecision, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';`,
    );
    expect(source).toContain(`export const pets = pgTable('pets', {`);
  });

  it('emits uuid() for format("uuid") fields', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `id: uuid('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID())`,
    );
  });

  it('emits timestamp({ mode: "string" }) for datetime fields', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `createdAt: timestamp('created_at', { mode: 'string' }).notNull().$defaultFn(() => new Date().toISOString())`,
    );
  });

  it('emits integer() for int32 and bigint({ mode: "number" }) for int64', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(`age: integer('age').notNull()`);
    expect(source).toContain(
      `visits: bigint('visits', { mode: 'number' }).notNull()`,
    );
  });

  it('emits doublePrecision() for float64 and boolean() for boolean', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `temperature: doublePrecision('temperature').notNull()`,
    );
    expect(source).toContain(`isFriendly: boolean('is_friendly').notNull()`);
  });

  it('emits jsonb() for arrays, records, tuples, and unions', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(`tags: jsonb('tags'),`);
    expect(source).toContain(`metadata: jsonb('metadata'),`);
  });

  it('emits text() with { enum: [...] } for enum columns', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `species: text('species', { enum: ['dog', 'cat', 'bird', 'fish'] }).notNull()`,
    );
  });

  it('emits references() for foreign keys using uuid() when applicable', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
    });
    const Adoption = t.model('Adoption', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      petId: t
        .string()
        .format('uuid')
        .storage({ references: 'pets.id' }),
    });
    const ep1 = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const ep2 = endpoint({
      name: 'getAdoption',
      method: 'GET',
      path: '/adoptions/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Adoption, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);
    const source = emitPostgres(walkRouter(router));
    expect(source).toContain(
      `petId: uuid('pet_id').references(() => pets.id).notNull()`,
    );
  });

  it('marks the dialect in the generated header', () => {
    const source = emitPostgres(walkRouter(singleTableRouter()));
    expect(source).toContain('Dialect: postgres');
  });
});

// ---------------------------------------------------------------------------
// Walker — string maxLength passthrough (needed by mysql varchar)
// ---------------------------------------------------------------------------

describe('walkRouter — string maxLength', () => {
  it('captures maxLength on string columns', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      name: t.string().maxLength(64),
      untyped: t.string(),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const tables = walkRouter(router);
    const cols = tables[0]?.columns ?? [];
    expect(cols.find((c) => c.fieldName === 'name')?.maxLength).toBe(64);
    expect(cols.find((c) => c.fieldName === 'untyped')?.maxLength).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MySQL emitter
// ---------------------------------------------------------------------------

describe('emitMysql', () => {
  function singleTableRouter() {
    const Pet = t.model('Pet', {
      id: t
        .string()
        .format('uuid')
        .storage({ primaryKey: true, defaultRandom: true }),
      name: t.string().minLength(1),
      label: t.string().maxLength(64),
      species: t.enum('dog', 'cat', 'bird', 'fish'),
      age: t.int32().min(0),
      visits: t.int64(),
      temperature: t.float64(),
      speed: t.float32(),
      isFriendly: t.boolean(),
      metadata: t.record(t.string(), t.unknown()).optional(),
      tags: t.array(t.string()).optional(),
      createdAt: t.datetime().storage({ defaultNow: true }),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    return router;
  }

  it('imports from drizzle-orm/mysql-core and uses mysqlTable', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`from 'drizzle-orm/mysql-core'`);
    expect(source).toContain('mysqlTable');
    expect(source).toContain(`export const pets = mysqlTable('pets', {`);
  });

  it('emits varchar({ length: 36 }) for uuid fields', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `id: varchar('id', { length: 36 }).notNull().primaryKey().$defaultFn(() => crypto.randomUUID())`,
    );
  });

  it('emits varchar with a 255 default length for plain strings', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`name: varchar('name', { length: 255 }).notNull()`);
  });

  it('honours .maxLength(n) on string fields', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`label: varchar('label', { length: 64 }).notNull()`);
  });

  it('emits datetime({ fsp: 3 }) for datetime fields', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `createdAt: datetime('created_at', { fsp: 3 }).notNull().$defaultFn(() => new Date().toISOString())`,
    );
  });

  it('emits int() for int32 and bigint({ mode: "number" }) for int64', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`age: int('age').notNull()`);
    expect(source).toContain(
      `visits: bigint('visits', { mode: 'number' }).notNull()`,
    );
  });

  it('emits float() and double() for float32 and float64', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`speed: float('speed').notNull()`);
    expect(source).toContain(`temperature: double('temperature').notNull()`);
  });

  it('emits boolean() for boolean columns', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`isFriendly: boolean('is_friendly').notNull()`);
  });

  it('emits json() for arrays, records, tuples, and unions', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(`tags: json('tags'),`);
    expect(source).toContain(`metadata: json('metadata'),`);
  });

  it('emits mysqlEnum() with an as-const tuple for enum columns', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `species: mysqlEnum('species', ['dog', 'cat', 'bird', 'fish'] as const).notNull()`,
    );
  });

  it('imports every helper it uses, sorted alphabetically after mysqlTable', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain(
      `import { mysqlTable, bigint, boolean, datetime, double, float, int, json, mysqlEnum, varchar } from 'drizzle-orm/mysql-core';`,
    );
  });

  it('emits references() for foreign keys using varchar uuid columns', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
    });
    const Adoption = t.model('Adoption', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      petId: t
        .string()
        .format('uuid')
        .storage({ references: 'pets.id' }),
    });
    const ep1 = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const ep2 = endpoint({
      name: 'getAdoption',
      method: 'GET',
      path: '/adoptions/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Adoption, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);
    const source = emitMysql(walkRouter(router));
    expect(source).toContain(
      `petId: varchar('pet_id', { length: 36 }).references(() => pets.id).notNull()`,
    );
  });

  it('marks the dialect in the generated header', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    expect(source).toContain('Dialect: mysql');
  });

  it('marks optional fields as nullable', () => {
    const source = emitMysql(walkRouter(singleTableRouter()));
    // tags is optional → no notNull
    expect(source).toMatch(/tags: json\('tags'\),/);
  });

  it('emits literal .default() for Triad defaults', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      status: t
        .enum('available', 'adopted', 'pending')
        .default('available'),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const source = emitMysql(walkRouter(router));
    expect(source).toContain(`.default('available')`);
  });
});

// ---------------------------------------------------------------------------
// generateDrizzleSchema — integration
// ---------------------------------------------------------------------------

describe('generateDrizzleSchema', () => {
  it('rejects unsupported dialects', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    // An unknown dialect should throw with a helpful message pointing
    // at the available dialects.
    expect(() =>
      generateDrizzleSchema(router, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dialect: 'oracle' as any,
      }),
    ).toThrow(CodegenError);
  });

  it('generates mysql output when dialect is mysql', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const mysql = generateDrizzleSchema(router, { dialect: 'mysql' });
    expect(mysql.source).toContain('mysqlTable');
    expect(mysql.source).toContain(`id: varchar('id', { length: 36 })`);
    expect(mysql.source).toContain(`from 'drizzle-orm/mysql-core'`);
  });

  it('generates both sqlite and postgres output from the same router', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const sqlite = generateDrizzleSchema(router, { dialect: 'sqlite' });
    const postgres = generateDrizzleSchema(router, { dialect: 'postgres' });
    expect(sqlite.source).toContain('sqliteTable');
    expect(sqlite.source).toContain(`id: text('id')`);
    expect(postgres.source).toContain('pgTable');
    expect(postgres.source).toContain(`id: uuid('id')`);
  });

  it('throws with a helpful message when no table models exist', () => {
    const ApiError = t.model('ApiError', {
      code: t.string(),
      message: t.string(),
    });
    const ep = endpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      summary: 'x',
      responses: { 200: { schema: ApiError, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
      behaviors: [
        scenario('s').given('x').when('y').then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    expect(() => generateDrizzleSchema(router)).toThrow(/no table models/i);
  });

  it('returns both the source string and the table descriptors', () => {
    const Pet = t.model('Pet', {
      id: t.string().storage({ primaryKey: true }),
      name: t.string(),
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () =>
        ({ status: 200, body: {} }) as never,
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const result = generateDrizzleSchema(router);
    expect(result.source).toContain('export const pets');
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.modelName).toBe('Pet');
  });
});
