---
name: triad-drizzle
description: Use when generating Drizzle ORM schemas from TriadJS models via `triad db generate`, choosing a dialect (sqlite/postgres/mysql), declaring `.storage()` hints on fields, designing repositories around the generated tables, or handling `isUniqueViolation` for domain-level conflict detection.
---

# Drizzle bridge

The Drizzle bridge is **not** a migration tool. It reads `.storage()` hints on your models and emits a Drizzle schema file that you then check in. `triad db generate` regenerates the file when schemas change. You can hand-edit the generated file if you need features Triad doesn't model — but beware that running the generator again will overwrite it.

## Marking a model as a table

Every field that should become a column must be on a `t.model` that has at least **one** field marked `.storage({ primaryKey: true })`. Models without a PK hint are not treated as tables and are skipped silently.

```ts
export const Pet = t.model('Pet', {
  id:        t.string().format('uuid').identity().storage({ primaryKey: true }),
  name:      t.string().minLength(1).maxLength(100).storage({ indexed: true }),
  species:   t.enum('dog', 'cat', 'bird', 'fish').storage({ indexed: true }),
  age:       t.int32().min(0).max(100),
  status:    t.enum('available', 'adopted', 'pending').default('available'),
  createdAt: t.datetime().storage({ defaultNow: true }),
});
```

> `.identity()` is the DDD identity marker; `.storage({ primaryKey: true })` is the persistence hint. **They are different and most ID fields need both.**

## `.storage()` options

| Option | Effect |
|---|---|
| `primaryKey: true` | Marks the field as the table's PK (required to become a table) |
| `unique: true` | Unique constraint |
| `indexed: true` | Secondary index |
| `columnName: 'user_id'` | Override the SQL column name |
| `defaultNow: true` | Default to `CURRENT_TIMESTAMP` |
| `defaultRandom: true` | Default to a random UUID |
| `references: 'projects.id'` | Foreign key reference |
| `custom: { ... }` | Dialect-specific hints |

`.storage()` accumulates across calls — you can chain multiple to layer hints.

## Dialects

`sqlite`, `postgres`, `mysql`. All three emit valid Drizzle `sqliteTable`/`pgTable`/`mysqlTable` definitions. Type mapping is logical:

| Triad type | Drizzle (SQLite) | Drizzle (Postgres) | Drizzle (MySQL) |
|---|---|---|---|
| `t.string()` | `text` | `text` | `text` |
| `t.string().format('uuid')` | `text` | `uuid` | `varchar(36)` |
| `t.datetime()` | `text` (ISO) | `text` (ISO) | `text` (ISO) |
| `t.int32()` | `integer` | `integer` | `int` |
| `t.int64()` | `integer` | `bigint` | `bigint` |
| `t.float64()` | `real` | `doublePrecision` | `double` |
| `t.boolean()` | `integer` (0/1) | `boolean` | `tinyint` |
| `t.enum(...)` | `text` + CHECK | `text` (or `pgEnum` if configured) | `text` |
| `t.array / t.record / ...` | `text` JSON | `jsonb` | `json` |

## Running the generator

```bash
triad db generate                                   # default: sqlite → ./src/db/schema.generated.ts
triad db generate --dialect postgres
triad db generate --dialect mysql --output ./src/db/schema.mysql.generated.ts
```

| Flag | Effect |
|---|---|
| `-o, --output <path>` | Output file path |
| `-d, --dialect <dialect>` | `sqlite`, `postgres`, or `mysql` |

## Using the generated schema

The generator writes one file. Import it into your Drizzle client:

```ts
// src/db/client.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.generated.js';

export function createDatabase(url = ':memory:') {
  const raw = new Database(url);
  const db = drizzle(raw, { schema });
  return Object.assign(db, { $raw: raw });
}
export type Db = ReturnType<typeof createDatabase>;
```

Your repositories then use standard Drizzle queries against the generated tables. Handlers stay agnostic — they only talk to the repository.

## Repository pattern + domain conflicts

Put DB code in `src/repositories/`. Handlers call `ctx.services.xRepo.method(...)` and do nothing else.

```ts
handler: async (ctx) => {
  const pet = await ctx.services.petRepo.create(ctx.body);
  return ctx.respond[201](pet);
}
```

### Detecting unique-constraint violations

`@triadjs/drizzle` exports `isUniqueViolation(err)` so repositories can map driver-specific duplicate-key errors into domain-level conflicts without a race-prone pre-check `SELECT`. Supported drivers:

- `better-sqlite3` — `SQLITE_CONSTRAINT_UNIQUE`
- `pg` — SQLSTATE `23505`
- `mysql2` — `ER_DUP_ENTRY`

The helper returns a structured `{ table?, column?, constraint? }` descriptor on match (possibly empty if the parser can't extract details) or `null` otherwise:

```ts
import { isUniqueViolation } from '@triadjs/drizzle';

class UserRepository {
  async create(input: NewUser): Promise<User> {
    try {
      return await this.db.insert(users).values(input).returning().get();
    } catch (err) {
      const conflict = isUniqueViolation(err);
      if (conflict) {
        throw new DuplicateEmailError(input.email, conflict);
      }
      throw err;
    }
  }
}
```

The repository throws a domain error; the endpoint handler catches it and maps to `ctx.respond[409]({ code: 'DUPLICATE', message: '...' })`.

## The bridge is not a migration tool

`triad db generate` produces a schema file. It does **not** compare against a live database, does **not** emit ALTER statements, and does **not** manage migration history. For migrations, use `drizzle-kit` against the generated file.

A typical workflow:

1. Edit `Pet.ts` — add a new field with `.storage()` hints.
2. `triad db generate` — regenerate `schema.generated.ts`.
3. `drizzle-kit generate` — produce a migration file.
4. `drizzle-kit migrate` — apply it.

## Checklist before generating the schema

1. Every model that should become a table has **at least one** `.storage({ primaryKey: true })` field.
2. ID fields have **both** `.identity()` and `.storage({ primaryKey: true })`.
3. Fields with foreign keys use `.storage({ references: 'other_table.id' })`.
4. Fields you want indexed have `.storage({ indexed: true })` — indexes are never auto-generated.
5. Enum columns work with `t.enum(...)`. Native Postgres `pgEnum` is a custom hint (`.storage({ custom: { pgEnum: true } })`), not the default.
6. Generated file is checked into git alongside your source — the CI pipeline verifies drift by running `triad db generate` and failing if the file changed.
