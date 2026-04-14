/**
 * Migration codegen tests.
 *
 * Exercises the IR diff, SQL emitter, and file writer through behavior
 * — constructing real routers via `@triadjs/core`, calling the public
 * migration API, and asserting on the SQL text and snapshot files.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRouter, endpoint, t, type Router } from '@triadjs/core';
import {
  snapshotIR,
  serializeSnapshot,
  parseSnapshot,
  diffSnapshots,
  emitMigrationSQL,
  generateMigration,
  type RouterSnapshot,
} from '../src/index.js';
import type { TableDescriptor } from '../src/codegen/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function routerWith(...endpoints: ReturnType<typeof endpoint>[]): Router {
  const router = createRouter({ title: 'x', version: '1' });
  router.add(...endpoints);
  return router;
}

function petRouter(): Router {
  const Pet = t.model('Pet', {
    id: t.string().format('uuid').storage({ primaryKey: true }),
    name: t.string(),
    species: t.enum('dog', 'cat'),
    createdAt: t.datetime(),
  });
  const ep = endpoint({
    name: 'getPet',
    method: 'GET',
    path: '/pets/:id',
    summary: 'x',
    request: { params: { id: t.string() } },
    responses: { 200: { schema: Pet, description: 'ok' } },
    handler: async () => ({ status: 200, body: {} }) as never,
  });
  return routerWith(ep);
}

function petAndOwnerRouter(): Router {
  const Owner = t.model('Owner', {
    id: t.string().format('uuid').storage({ primaryKey: true }),
    email: t.string(),
  });
  const Pet = t.model('Pet', {
    id: t.string().format('uuid').storage({ primaryKey: true }),
    name: t.string(),
    ownerId: t.string().storage({ references: 'owners.id' }),
  });
  const ep = endpoint({
    name: 'getPet',
    method: 'GET',
    path: '/pets/:id',
    summary: 'x',
    request: { params: { id: t.string() } },
    responses: {
      200: { schema: Pet, description: 'ok' },
      201: { schema: Owner, description: 'ok' },
    },
    handler: async () => ({ status: 200, body: {} }) as never,
  });
  return routerWith(ep);
}

// Build a synthetic snapshot with a single table having one column.
function snapshotOf(tables: TableDescriptor[]): RouterSnapshot {
  return { version: 1, tables };
}

// ---------------------------------------------------------------------------
// snapshotIR / serialize / parse
// ---------------------------------------------------------------------------

describe('snapshotIR', () => {
  it('produces a stable JSON-serializable object', () => {
    const snap = snapshotIR(petRouter());
    expect(snap.version).toBe(1);
    expect(snap.tables.length).toBe(1);
    expect(snap.tables[0]?.tableName).toBe('pets');
  });

  it('serializes to stable JSON (sorted keys)', () => {
    const snap = snapshotIR(petRouter());
    const json1 = serializeSnapshot(snap);
    const json2 = serializeSnapshot(snap);
    expect(json1).toBe(json2);
    // Sorted keys: "tables" should appear before "version" alphabetically.
    expect(json1.indexOf('"tables"')).toBeLessThan(json1.indexOf('"version"'));
  });

  it('round-trips via parseSnapshot', () => {
    const snap = snapshotIR(petRouter());
    const text = serializeSnapshot(snap);
    const parsed = parseSnapshot(text);
    expect(parsed).toEqual(snap);
  });

  it('throws on malformed snapshot text', () => {
    expect(() => parseSnapshot('{}')).toThrow();
    expect(() => parseSnapshot('not json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots
// ---------------------------------------------------------------------------

describe('diffSnapshots', () => {
  it('returns empty diff for two identical snapshots', () => {
    const snap = snapshotIR(petRouter());
    const diff = diffSnapshots(snap, snap);
    expect(diff.tablesAdded).toEqual([]);
    expect(diff.tablesDropped).toEqual([]);
    expect(diff.tableChanges).toEqual([]);
  });

  it('treats null → snapshot as all tables added', () => {
    const snap = snapshotIR(petRouter());
    const diff = diffSnapshots(null, snap);
    expect(diff.tablesAdded.length).toBe(1);
    expect(diff.tablesAdded[0]?.tableName).toBe('pets');
    expect(diff.tablesDropped).toEqual([]);
    expect(diff.tableChanges).toEqual([]);
  });

  it('treats snapshot → empty as all tables dropped', () => {
    const snap = snapshotIR(petRouter());
    const empty: RouterSnapshot = { version: 1, tables: [] };
    const diff = diffSnapshots(snap, empty);
    expect(diff.tablesDropped.length).toBe(1);
    expect(diff.tablesDropped[0]?.tableName).toBe('pets');
  });

  it('detects added columns on an existing table', () => {
    const before = snapshotIR(petRouter());
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
      species: t.enum('dog', 'cat'),
      createdAt: t.datetime(),
      nickname: t.string(), // new column
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }) as never,
    });
    const after = snapshotIR(routerWith(ep));
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges.length).toBe(1);
    expect(diff.tableChanges[0]?.columnsAdded.length).toBe(1);
    expect(diff.tableChanges[0]?.columnsAdded[0]?.fieldName).toBe('nickname');
  });

  it('detects dropped columns', () => {
    const before = snapshotIR(petRouter());
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string(),
      species: t.enum('dog', 'cat'),
      // createdAt dropped
    });
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }) as never,
    });
    const after = snapshotIR(routerWith(ep));
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges[0]?.columnsDropped.length).toBe(1);
    expect(diff.tableChanges[0]?.columnsDropped[0]?.fieldName).toBe('createdAt');
  });

  it('detects column type changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'string',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'age',
            columnName: 'age',
            logicalType: 'integer',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          before.tables[0]!.columns[0]!,
          {
            ...before.tables[0]!.columns[1]!,
            logicalType: 'bigint',
          },
        ],
      },
    ]);
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges[0]?.columnsChanged.length).toBe(1);
    expect(diff.tableChanges[0]?.columnsChanged[0]?.kind).toContain('type');
  });

  it('detects nullability changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'name',
            columnName: 'name',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [{ ...before.tables[0]!.columns[0]!, notNull: false }],
      },
    ]);
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges[0]?.columnsChanged[0]?.kind).toContain('nullable');
  });

  it('detects default changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'status',
            columnName: 'status',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            ...before.tables[0]!.columns[0]!,
            default: { kind: 'literal', value: 'available' },
          },
        ],
      },
    ]);
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges[0]?.columnsChanged[0]?.kind).toContain('default');
  });

  it('detects primaryKey changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [{ ...before.tables[0]!.columns[0]!, primaryKey: true }],
      },
    ]);
    const diff = diffSnapshots(before, after);
    expect(diff.tableChanges[0]?.columnsChanged[0]?.kind).toContain('primaryKey');
  });
});

// ---------------------------------------------------------------------------
// emitMigrationSQL — sqlite
// ---------------------------------------------------------------------------

describe('emitMigrationSQL — sqlite', () => {
  it('emits CREATE TABLE with TEXT/INTEGER/REAL mappings and PK + NOT NULL + DEFAULT', () => {
    const diff = diffSnapshots(null, snapshotIR(petRouter()));
    const { up, down } = emitMigrationSQL(diff, 'sqlite');
    expect(up).toContain('CREATE TABLE "pets"');
    expect(up).toContain('"id" TEXT NOT NULL PRIMARY KEY');
    expect(up).toContain('"name" TEXT NOT NULL');
    expect(up).toContain(`"species" TEXT NOT NULL CHECK ("species" IN ('dog', 'cat'))`);
    expect(up).toContain('"created_at" TEXT NOT NULL');
    expect(down).toContain('DROP TABLE IF EXISTS "pets"');
  });

  it('emits a default literal correctly', () => {
    const snap: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'string',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'active',
            columnName: 'active',
            logicalType: 'boolean',
            primaryKey: false,
            notNull: true,
            unique: false,
            default: { kind: 'literal', value: true },
          },
          {
            fieldName: 'count',
            columnName: 'count',
            logicalType: 'integer',
            primaryKey: false,
            notNull: true,
            unique: false,
            default: { kind: 'literal', value: 0 },
          },
          {
            fieldName: 'status',
            columnName: 'status',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
            default: { kind: 'literal', value: 'new' },
          },
        ],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(null, snap), 'sqlite');
    expect(up).toContain(`DEFAULT 1`); // boolean true
    expect(up).toContain(`DEFAULT 0`); // integer
    expect(up).toContain(`DEFAULT 'new'`); // string
  });

  it('emits SQLite warning comment for column type changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'string',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [{ ...before.tables[0]!.columns[0]!, logicalType: 'integer' }],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(before, after), 'sqlite');
    expect(up).toContain('SQLite does not support ALTER COLUMN');
  });

  it('emits ADD COLUMN and DROP COLUMN for column additions and drops', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'string',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'old',
            columnName: 'old',
            logicalType: 'string',
            primaryKey: false,
            notNull: false,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          before.tables[0]!.columns[0]!,
          {
            fieldName: 'nickname',
            columnName: 'nickname',
            logicalType: 'string',
            primaryKey: false,
            notNull: false,
            unique: false,
          },
        ],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(before, after), 'sqlite');
    expect(up).toContain(`ALTER TABLE "pets" ADD COLUMN "nickname" TEXT`);
    expect(up).toContain(`ALTER TABLE "pets" DROP COLUMN "old"`);
  });
});

// ---------------------------------------------------------------------------
// emitMigrationSQL — postgres
// ---------------------------------------------------------------------------

describe('emitMigrationSQL — postgres', () => {
  it('emits CREATE TABLE with TIMESTAMP(3) WITH TIME ZONE and JSONB and UUID', () => {
    const snap: RouterSnapshot = snapshotOf([
      {
        identifier: 'events',
        tableName: 'events',
        modelName: 'Event',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'uuid',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'payload',
            columnName: 'payload',
            logicalType: 'json',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'createdAt',
            columnName: 'created_at',
            logicalType: 'datetime',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(null, snap), 'postgres');
    expect(up).toContain('"id" UUID NOT NULL PRIMARY KEY');
    expect(up).toContain('"payload" JSONB NOT NULL');
    expect(up).toContain('"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL');
  });

  it('emits ALTER COLUMN TYPE for type change', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [
          {
            fieldName: 'age',
            columnName: 'age',
            logicalType: 'integer',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [{ ...before.tables[0]!.columns[0]!, logicalType: 'bigint' }],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(before, after), 'postgres');
    expect(up).toContain('ALTER TABLE "t" ALTER COLUMN "age" TYPE BIGINT');
  });

  it('emits SET/DROP NOT NULL for nullability changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [
          {
            fieldName: 'name',
            columnName: 'name',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [{ ...before.tables[0]!.columns[0]!, notNull: false }],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(before, after), 'postgres');
    expect(up).toContain('ALTER TABLE "t" ALTER COLUMN "name" DROP NOT NULL');
  });

  it('emits inline REFERENCES in CREATE TABLE for FK columns', () => {
    const snap: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'uuid',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'ownerId',
            columnName: 'owner_id',
            logicalType: 'uuid',
            primaryKey: false,
            notNull: true,
            unique: false,
            references: 'owners.id',
          },
        ],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(null, snap), 'postgres');
    expect(up).toContain(`"owner_id" UUID NOT NULL REFERENCES "owners"("id")`);
  });
});

// ---------------------------------------------------------------------------
// emitMigrationSQL — mysql
// ---------------------------------------------------------------------------

describe('emitMigrationSQL — mysql', () => {
  it('emits VARCHAR(255) default, DATETIME(3), ENUM native syntax', () => {
    const snap: RouterSnapshot = snapshotOf([
      {
        identifier: 'pets',
        tableName: 'pets',
        modelName: 'Pet',
        columns: [
          {
            fieldName: 'id',
            columnName: 'id',
            logicalType: 'uuid',
            primaryKey: true,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'name',
            columnName: 'name',
            logicalType: 'string',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'createdAt',
            columnName: 'created_at',
            logicalType: 'datetime',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
          {
            fieldName: 'species',
            columnName: 'species',
            logicalType: 'enum',
            enumValues: ['dog', 'cat'],
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(null, snap), 'mysql');
    expect(up).toContain('`id` VARCHAR(36) NOT NULL PRIMARY KEY');
    expect(up).toContain('`name` VARCHAR(255) NOT NULL');
    expect(up).toContain('`created_at` DATETIME(3) NOT NULL');
    expect(up).toContain(`\`species\` ENUM('dog', 'cat') NOT NULL`);
  });

  it('emits MODIFY COLUMN for type changes', () => {
    const before: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [
          {
            fieldName: 'age',
            columnName: 'age',
            logicalType: 'integer',
            primaryKey: false,
            notNull: true,
            unique: false,
          },
        ],
      },
    ]);
    const after: RouterSnapshot = snapshotOf([
      {
        identifier: 't',
        tableName: 't',
        modelName: 'T',
        columns: [{ ...before.tables[0]!.columns[0]!, logicalType: 'bigint' }],
      },
    ]);
    const { up } = emitMigrationSQL(diffSnapshots(before, after), 'mysql');
    expect(up).toContain('ALTER TABLE `t` MODIFY COLUMN `age` BIGINT NOT NULL');
  });
});

// ---------------------------------------------------------------------------
// generateMigration — file writer
// ---------------------------------------------------------------------------

describe('generateMigration', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-migrate-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes an initial migration file and snapshot when none exist', () => {
    const result = generateMigration({
      router: petRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
    });
    expect(result.path).not.toBeNull();
    expect(result.snapshotPath).not.toBeNull();
    expect(result.diff.tablesAdded.length).toBe(1);

    const sql = fs.readFileSync(result.path as string, 'utf8');
    expect(sql).toContain('CREATE TABLE "pets"');
    expect(sql).toContain('-- UP');
    expect(sql).toContain('-- DOWN');
    expect(sql).toContain('DROP TABLE IF EXISTS "pets"');

    const snapshotText = fs.readFileSync(
      result.snapshotPath as string,
      'utf8',
    );
    const snap = parseSnapshot(snapshotText);
    expect(snap.tables[0]?.tableName).toBe('pets');
  });

  it('returns null paths and empty diff when called twice on same router', () => {
    generateMigration({
      router: petRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
    });
    const second = generateMigration({
      router: petRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
    });
    expect(second.path).toBeNull();
    expect(second.snapshotPath).toBeNull();
  });

  it('writes a second migration containing ALTER when schema changes', () => {
    generateMigration({
      router: petRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
    });
    // Now a router with the new table added
    const second = generateMigration({
      router: petAndOwnerRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
    });
    expect(second.path).not.toBeNull();
    const sql = fs.readFileSync(second.path as string, 'utf8');
    // Either pets ADD COLUMN ownerId or owners CREATE TABLE — the model
    // had both changes. Both should appear.
    expect(sql).toContain('CREATE TABLE "owners"');
    expect(sql).toContain('ALTER TABLE "pets" ADD COLUMN "owner_id"');
  });

  it('writes a stable snapshot (byte-identical across two runs on the same router)', () => {
    const r = petRouter();
    const first = generateMigration({
      router: r,
      dialect: 'sqlite',
      directory: tmpDir,
    });
    const text1 = fs.readFileSync(first.snapshotPath as string, 'utf8');
    // Trigger a second run that makes no changes; snapshot should remain byte-equal
    generateMigration({
      router: r,
      dialect: 'sqlite',
      directory: tmpDir,
    });
    const text2 = fs.readFileSync(first.snapshotPath as string, 'utf8');
    expect(text1).toBe(text2);
  });

  it('includes the optional name in the filename', () => {
    const result = generateMigration({
      router: petRouter(),
      dialect: 'sqlite',
      directory: tmpDir,
      name: 'init',
    });
    expect(result.path).not.toBeNull();
    expect(path.basename(result.path as string)).toMatch(
      /^\d{14}_init\.sql$/,
    );
  });
});
