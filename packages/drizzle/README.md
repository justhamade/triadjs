# @triadjs/drizzle

Drizzle ORM bridge for Triad — schema codegen, validation bridge, and migration tools.

Triad keeps the **API contract** (`t.model()`) separate from the **storage contract** (`pgTable()` / `sqliteTable()`). This package connects the two with type helpers, runtime validation at the repository boundary, portable error introspection, and a codegen pipeline that turns `.storage()` hints into Drizzle table definitions.

## Install

```bash
npm install @triadjs/drizzle
```

**Peer dependency:** `drizzle-orm`

## Quick start

### 1. Annotate your model with `.storage()` hints

```ts
import { t } from '@triadjs/core';

const Pet = t.model('Pet', {
  id:   t.string().format('uuid').storage({ primaryKey: true }),
  name: t.string().storage({ columnName: 'pet_name' }),
  age:  t.integer().optional(),
});
```

### 2. Validate rows at the repository boundary

```ts
import { validateAgainst } from '@triadjs/drizzle';
import { Pet } from './schemas/pet.js';
import { pets } from './db/schema.js';

async function findById(db, id: string) {
  const row = await db.select().from(pets).where(eq(pets.id, id)).get();
  if (!row) return null;
  return validateAgainst(Pet, rowToApi(row));
}
```

`validateAgainst` parses the mapped row through the Triad model. If the DB drifts from the API schema, the mismatch surfaces immediately instead of sending malformed data to clients.

A non-throwing variant is also available:

```ts
import { validateAgainstSafe } from '@triadjs/drizzle';

const result = validateAgainstSafe(Pet, row);
if (!result.success) console.error(result.errors);
```

## Type helpers

```ts
import type { InferRow, InferInsert } from '@triadjs/drizzle';
import { pets } from './db/schema.js';

type PetRow    = InferRow<typeof pets>;    // DB row
type PetInsert = InferInsert<typeof pets>; // insert shape
```

## Schema codegen

`triad db generate` walks the router, reads `.storage()` hints, and emits Drizzle table definitions for **SQLite**, **Postgres**, or **MySQL**.

```bash
triad db generate --dialect postgres --output src/db/schema.ts
```

Programmatic usage:

```ts
import { generateDrizzleSchema } from '@triadjs/drizzle';

const { source, tables } = generateDrizzleSchema(router, {
  dialect: 'postgres',
});
```

The pipeline is two-stage — `walkRouter()` produces dialect-neutral `TableDescriptor[]`, then `emitForDialect()` renders TypeScript source — so tooling can consume or transform the intermediate representation.

## Migration codegen

Diff two router snapshots and emit SQL migration files:

```ts
import { generateMigration } from '@triadjs/drizzle';
```

Or via the CLI:

```bash
triad db migrate --dialect postgres --dir ./migrations
```

## Helpers

### `findPrimaryKey(model)`

Returns the field name marked with `.storage({ primaryKey: true })`, or `undefined` if none is set.

```ts
import { findPrimaryKey } from '@triadjs/drizzle';

findPrimaryKey(Pet); // "id"
```

### `isUniqueViolation(err)`

Detect unique-constraint violations portably across better-sqlite3, node-postgres, and mysql2. Returns a `DbError` descriptor (`{ table?, column?, constraint? }`) when matched, or `null` otherwise.

```ts
import { isUniqueViolation } from '@triadjs/drizzle';

try {
  await db.insert(users).values(input).returning().get();
} catch (err) {
  const conflict = isUniqueViolation(err);
  if (conflict) throw new DuplicateEmailError(input.email);
  throw err;
}
```

## Links

- [Drizzle integration guide](../../docs/drizzle-integration.md)
- [Triad documentation](../../docs/)
