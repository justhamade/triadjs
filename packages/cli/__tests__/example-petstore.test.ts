/**
 * End-to-end regression test for the `examples/petstore/` reference app.
 *
 * Runs every CLI command (validate, docs, gherkin, test) against the
 * real example project. This doubles as:
 *
 *   1. A regression net — if a future change breaks the example, this
 *      test fails in `npm test` before it ships.
 *   2. An integration contract — proves the entire pipeline (config
 *      loading, jiti router import, schema walking, Fastify-free
 *      in-process test runner, CLI generators) actually works on a
 *      realistic project.
 *
 * Uses the command functions directly rather than spawning the `triad`
 * binary so failures surface full stack traces in the test reporter.
 * Output is captured to keep the test log clean.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDocs } from '../src/commands/docs.js';
import { runGherkin } from '../src/commands/gherkin.js';
import { runTest } from '../src/commands/test.js';
import { runValidate } from '../src/commands/validate.js';
import { runDbGenerate } from '../src/commands/db.js';

const EXAMPLE_DIR = fileURLToPath(
  new URL('../../../examples/petstore/', import.meta.url),
);
const CONFIG = path.join(EXAMPLE_DIR, 'triad.config.ts');
const GENERATED = path.join(EXAMPLE_DIR, 'generated');

function withCapturedStdout<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let buffer = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array) => {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  return fn()
    .then((result) => ({ result, output: buffer }))
    .finally(() => {
      process.stdout.write = original;
    });
}

beforeAll(() => {
  // Clean any previous generated artifacts.
  if (fs.existsSync(GENERATED)) {
    fs.rmSync(GENERATED, { recursive: true, force: true });
  }
});

afterAll(() => {
  // Don't leave artifacts in git — the example's .gitignore already
  // excludes `generated/`, but cleaning keeps the workspace tidy for
  // interactive development.
  if (fs.existsSync(GENERATED)) {
    fs.rmSync(GENERATED, { recursive: true, force: true });
  }
});

describe('example petstore — triad validate', () => {
  it('passes all checks', async () => {
    const { output } = await withCapturedStdout(() =>
      runValidate({ config: CONFIG }),
    );
    expect(output).toContain('All checks passed');
  });
});

describe('example petstore — triad docs', () => {
  it('writes a complete OpenAPI spec with every endpoint and model', async () => {
    const { output } = await withCapturedStdout(() =>
      runDocs({ config: CONFIG }),
    );
    expect(output).toContain('OpenAPI YAML written');

    const specPath = path.join(GENERATED, 'openapi.yaml');
    expect(fs.existsSync(specPath)).toBe(true);
    const spec = fs.readFileSync(specPath, 'utf8');

    // Every endpoint should be present.
    expect(spec).toContain('operationId: createPet');
    expect(spec).toContain('operationId: getPet');
    expect(spec).toContain('operationId: listPets');
    expect(spec).toContain('operationId: updatePet');
    expect(spec).toContain('operationId: createAdopter');
    expect(spec).toContain('operationId: requestAdoption');
    expect(spec).toContain('operationId: completeAdoption');

    // Every top-level model should be in components/schemas.
    expect(spec).toContain('Pet:');
    expect(spec).toContain('CreatePet:');
    expect(spec).toContain('UpdatePet:');
    expect(spec).toContain('Adopter:');
    expect(spec).toContain('Adoption:');
    expect(spec).toContain('ApiError:');

    // Bounded contexts appear as top-level tags with descriptions.
    expect(spec).toContain('name: Pets');
    expect(spec).toContain('name: Adoption');

    // The `Money` value object should be inlined (not a $ref component).
    expect(spec).not.toMatch(/^ {4}Money:/m);
    expect(spec).toContain('title: Money');
  });

  it('emits an AsyncAPI 3.0 doc alongside OpenAPI when channels exist', async () => {
    const { output } = await withCapturedStdout(() =>
      runDocs({ config: CONFIG }),
    );
    // Both formats announced.
    expect(output).toContain('OpenAPI YAML written');
    expect(output).toContain('AsyncAPI YAML written');

    const asyncapiPath = path.join(GENERATED, 'asyncapi.yaml');
    expect(fs.existsSync(asyncapiPath)).toBe(true);
    const spec = fs.readFileSync(asyncapiPath, 'utf8');

    // AsyncAPI 3.0 document header
    expect(spec).toContain('asyncapi: 3.0.0');
    expect(spec).toContain('title: Petstore API');

    // The chat room channel is present with its address
    expect(spec).toContain('chatRoom:');
    expect(spec).toContain('address: /ws/rooms/{roomId}');

    // Operations are namespaced by direction to avoid collisions when
    // the same message name appears on both sides.
    expect(spec).toContain('chatRoom.client.sendMessage:');
    expect(spec).toContain('chatRoom.server.message:');
    expect(spec).toContain('chatRoom.server.presence:');

    // Component schemas shared with OpenAPI (ChatMessage, etc)
    expect(spec).toContain('ChatMessage:');
    expect(spec).toContain('UserPresence:');

    // Chat bounded context surfaces as a top-level tag
    expect(spec).toMatch(/name: Chat/);
  });
});

describe('example petstore — triad gherkin', () => {
  it('writes a .feature file per bounded context, including channels', async () => {
    const { output } = await withCapturedStdout(() =>
      runGherkin({ config: CONFIG }),
    );
    expect(output).toContain('Wrote 3 feature file(s)');

    const dir = path.join(GENERATED, 'features');
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([
      'adoption.feature',
      'chat.feature',
      'pets.feature',
    ]);

    const petsFeature = fs.readFileSync(path.join(dir, 'pets.feature'), 'utf8');
    expect(petsFeature).toContain('Feature: Pets');
    expect(petsFeature).toContain('Pet catalog and CRUD operations.');
    expect(petsFeature).toContain('Scenario: Pets can be created with valid data');
    // Data table rendered from given.body
    expect(petsFeature).toContain('| name    | Buddy |');

    const adoptionFeature = fs.readFileSync(
      path.join(dir, 'adoption.feature'),
      'utf8',
    );
    expect(adoptionFeature).toContain('Feature: Adoption');
    expect(adoptionFeature).toContain('Scenario: Available pets can be adopted');

    // Channel behaviors flow through the same feature file grouping.
    const chatFeature = fs.readFileSync(path.join(dir, 'chat.feature'), 'utf8');
    expect(chatFeature).toContain('Feature: Chat');
    expect(chatFeature).toContain(
      'Real-time chat rooms backed by WebSocket channels.',
    );
    expect(chatFeature).toContain(
      'Scenario: Users can post messages to a room they have joined',
    );
    expect(chatFeature).toContain('When client sends sendMessage');
    expect(chatFeature).toContain('Then client receives a message event');
  });
});

describe('example petstore — triad test', () => {
  it('runs HTTP + channel behaviors and all scenarios pass', async () => {
    const { output } = await withCapturedStdout(() =>
      runTest({ config: CONFIG }),
    );
    // 14 HTTP scenarios across 7 endpoints + 2 channel scenarios.
    expect(output).toContain('16 scenarios');
    expect(output).toContain('16 passed');
    expect(output).not.toContain('failed');
    expect(output).not.toContain('errored');

    // Spot-check HTTP endpoint scenarios.
    expect(output).toContain('Pets can be created with valid data');
    expect(output).toContain('Requested adoptions can be completed');

    // Spot-check the WebSocket chat room scenarios.
    expect(output).toContain('WS /ws/rooms/:roomId — chatRoom');
    expect(output).toContain('Users can post messages to a room they have joined');
    expect(output).toContain('Posted messages are persisted via the MessageStore');
  });
});

describe('example petstore — triad db generate', () => {
  const GENERATED_SCHEMA = path.join(
    EXAMPLE_DIR,
    'src',
    'db',
    'schema.generated.ts',
  );

  afterAll(() => {
    // This file is gitignored but regenerated on every run; tidy up so
    // the workspace stays clean during local development.
    if (fs.existsSync(GENERATED_SCHEMA)) {
      fs.rmSync(GENERATED_SCHEMA, { force: true });
    }
  });

  it('emits a Drizzle schema covering every table model', async () => {
    const { output } = await withCapturedStdout(() =>
      runDbGenerate({ config: CONFIG }),
    );
    expect(output).toContain('Drizzle sqlite schema written');
    expect(output).toContain('3 table(s)');
    expect(output).toContain('pets');
    expect(output).toContain('adopters');
    expect(output).toContain('adoptions');

    const source = fs.readFileSync(GENERATED_SCHEMA, 'utf8');

    // Header
    expect(source).toContain('Generated by `triad db generate`');
    expect(source).toContain('Do not edit by hand');

    // Imports — only what we actually use, sorted alphabetically.
    expect(source).toContain(
      `import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';`,
    );

    // Each table
    expect(source).toContain(`export const pets = sqliteTable('pets'`);
    expect(source).toContain(`export const adopters = sqliteTable('adopters'`);
    expect(source).toContain(`export const adoptions = sqliteTable('adoptions'`);

    // Primary keys
    expect(source).toContain(`id: text('id').notNull().primaryKey()`);

    // Money value object flattened into two columns
    expect(source).toContain(
      `adoptionFeeAmount: integer('adoption_fee_amount').notNull()`,
    );
    expect(source).toContain(
      `adoptionFeeCurrency: text('adoption_fee_currency', { enum: ['USD', 'CAD', 'EUR'] }).notNull()`,
    );
    expect(source).toContain(`feeAmount: integer('fee_amount').notNull()`);

    // Foreign keys on adoptions
    expect(source).toContain(
      `petId: text('pet_id').references(() => pets.id).notNull()`,
    );
    expect(source).toContain(
      `adopterId: text('adopter_id').references(() => adopters.id).notNull()`,
    );

    // Enum constraints
    expect(source).toContain(
      `species: text('species', { enum: ['dog', 'cat', 'bird', 'fish'] }).notNull()`,
    );

    // Default value for status enum
    expect(source).toContain(`.default('available')`);

    // $defaultFn for datetime fields with defaultNow hint
    expect(source).toContain(
      `$defaultFn(() => new Date().toISOString())`,
    );

    // Unique constraint on email
    expect(source).toContain(`email: text('email').notNull().unique()`);

    // Optional fields (completedAt) should NOT have notNull
    expect(source).toContain(`completedAt: text('completed_at'),`);

    // tags is optional array → text column with no notNull
    expect(source).toContain(`tags: text('tags'),`);

    // Generated file should never contain the storage metadata itself
    expect(source).not.toContain('storage');
    expect(source).not.toContain('indexed');
  });

  it('respects --output override', async () => {
    const altPath = path.join(EXAMPLE_DIR, 'src', 'db', 'alt.generated.ts');
    try {
      await withCapturedStdout(() =>
        runDbGenerate({
          config: CONFIG,
          output: './src/db/alt.generated.ts',
        }),
      );
      expect(fs.existsSync(altPath)).toBe(true);
    } finally {
      if (fs.existsSync(altPath)) fs.rmSync(altPath, { force: true });
    }
  });

  it('emits a Postgres schema with pg-core native types', async () => {
    const pgPath = path.join(EXAMPLE_DIR, 'src', 'db', 'schema.pg.ts');
    try {
      await withCapturedStdout(() =>
        runDbGenerate({
          config: CONFIG,
          output: './src/db/schema.pg.ts',
          dialect: 'postgres',
        }),
      );
      expect(fs.existsSync(pgPath)).toBe(true);
      const source = fs.readFileSync(pgPath, 'utf8');

      // Postgres imports
      expect(source).toContain(`from 'drizzle-orm/pg-core'`);
      expect(source).toContain('pgTable');

      // Native Postgres column types
      expect(source).toContain('uuid('); // format('uuid') fields → real uuid columns
      expect(source).toContain(`timestamp('created_at', { mode: 'string' })`);
      expect(source).toContain(`timestamp('requested_at', { mode: 'string' })`);

      // Each table uses pgTable
      expect(source).toContain(`export const pets = pgTable('pets'`);
      expect(source).toContain(`export const adopters = pgTable('adopters'`);
      expect(source).toContain(`export const adoptions = pgTable('adoptions'`);

      // Foreign keys reference the uuid columns
      expect(source).toContain(
        `petId: uuid('pet_id').references(() => pets.id).notNull()`,
      );

      // Enums still carry their values
      expect(source).toContain(
        `species: text('species', { enum: ['dog', 'cat', 'bird', 'fish'] }).notNull()`,
      );

      // Header marks the dialect
      expect(source).toContain('Dialect: postgres');
    } finally {
      if (fs.existsSync(pgPath)) fs.rmSync(pgPath, { force: true });
    }
  });

  it('emits a MySQL schema with mysql-core native types', async () => {
    const myPath = path.join(EXAMPLE_DIR, 'src', 'db', 'schema.my.ts');
    try {
      await withCapturedStdout(() =>
        runDbGenerate({
          config: CONFIG,
          output: './src/db/schema.my.ts',
          dialect: 'mysql',
        }),
      );
      expect(fs.existsSync(myPath)).toBe(true);
      const source = fs.readFileSync(myPath, 'utf8');

      // MySQL imports
      expect(source).toContain(`from 'drizzle-orm/mysql-core'`);
      expect(source).toContain('mysqlTable');

      // Native MySQL column types
      expect(source).toContain(`varchar('id', { length: 36 })`);
      expect(source).toContain(`datetime('created_at', { fsp: 3 })`);
      expect(source).toContain(`datetime('requested_at', { fsp: 3 })`);

      // Each table uses mysqlTable
      expect(source).toContain(`export const pets = mysqlTable('pets'`);
      expect(source).toContain(`export const adopters = mysqlTable('adopters'`);
      expect(source).toContain(
        `export const adoptions = mysqlTable('adoptions'`,
      );

      // Foreign keys reference varchar uuid columns
      expect(source).toContain(
        `petId: varchar('pet_id', { length: 36 }).references(() => pets.id).notNull()`,
      );

      // Enum columns use the native mysqlEnum helper
      expect(source).toContain(
        `species: mysqlEnum('species', ['dog', 'cat', 'bird', 'fish'] as const).notNull()`,
      );

      // Header marks the dialect
      expect(source).toContain('Dialect: mysql');
    } finally {
      if (fs.existsSync(myPath)) fs.rmSync(myPath, { force: true });
    }
  });
});
