# Choosing an ORM

Triad's core does not know or care whether your handlers touch a database at all. Handlers call `ctx.services.<something>` and `ctx.services` is whatever you construct in `createServices()`. That means every ORM, query builder, or raw driver on npm is a valid choice.

Triad does ship one piece of optional ORM machinery: `@triad/drizzle`, a **bridge** that generates Drizzle table definitions from your Triad schemas. This is the default happy path, but it is opt-in. Skipping it costs you nothing except the codegen convenience.

This guide covers five paths — Drizzle with the bridge, Drizzle without the bridge, Prisma, Kysely, and raw SQL — and a decision tree at the end. For deeper Drizzle detail see [`docs/drizzle-integration.md`](../drizzle-integration.md).

---

## 1. What the Drizzle bridge is — and isn't

`@triad/drizzle` is **not an ORM**. It is a thin layer that does three things:

1. **Codegen**: walks your `Router`, reads `.storage(...)` hints on your models, and emits a Drizzle schema file (`triad db generate --dialect sqlite|postgres|mysql`).
2. **Type helpers**: `InferRow<typeof table>` and `InferInsert<typeof table>` mirror Drizzle's own inference so your repositories can type their row-shaped data without repeating the column list.
3. **Dialect awareness**: one command produces valid `sqliteTable` / `pgTable` / `mysqlTable` definitions from the same Triad models.

What it does **not** do:

- It does **not** run migrations. Use `drizzle-kit` (or your own migration tool) for that.
- It does **not** talk to the database. It emits a TypeScript file; your Drizzle client reads it.
- It does **not** require itself. A Triad app can use `@triad/core` + `better-sqlite3` + hand-written SQL and never install `@triad/drizzle`.

The bridge exists because the most common Triad app uses Drizzle, and having `.storage({ primaryKey: true })` next to `.identity()` on a schema field is the cleanest way to keep the API contract and the storage contract visibly aligned. If you are not using Drizzle, the metadata is simply ignored.

Reference: `packages/drizzle/src/codegen/`.

---

## 2. Path A — Drizzle with the bridge (the default)

This is what `examples/petstore` and `examples/tasktracker` do. You write Triad schemas with `.storage(...)` hints, run `triad db generate`, get a Drizzle schema file, and build repositories on top of it.

### Model with storage hints

```ts
import { t } from '@triad/core';

export const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  name: t.string().minLength(1).maxLength(100).storage({ indexed: true }),
  species: t.enum('dog', 'cat', 'bird', 'fish').storage({ indexed: true }),
  age: t.int32().min(0).max(100),
  status: t.enum('available', 'adopted', 'pending').default('available'),
  createdAt: t.datetime().storage({ defaultNow: true }),
});
```

Every field with `.storage(...)` contributes a hint to the codegen. Models with at least one `.storage({ primaryKey: true })` become tables; models without primary keys are skipped (treated as transport-only DTOs).

Available `.storage()` options (see [`docs/ai-agent-guide.md` §10.2](../ai-agent-guide.md#102-storage-options)):

| Option | Effect |
|---|---|
| `primaryKey: true` | Required for a model to become a table |
| `unique: true` | Unique constraint |
| `indexed: true` | Secondary index |
| `columnName: 'user_id'` | Override the SQL column name |
| `defaultNow: true` | Default to `CURRENT_TIMESTAMP` |
| `defaultRandom: true` | Default to a random UUID |
| `references: 'projects.id'` | Foreign key |
| `custom: { ... }` | Dialect-specific hints |

### Generate the schema

```bash
triad db generate --dialect sqlite --output ./src/db/schema.generated.ts
triad db generate --dialect postgres
triad db generate --dialect mysql
```

Commit the generated file — it is not a build artifact, it is your source of truth for Drizzle's view of the database. Rerun it when your Triad schemas change.

### Repository with `InferRow` / `InferInsert`

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';
import type { InferRow, InferInsert } from '@triad/drizzle';
import type { Db } from '../db/client.js';
import { pets } from '../db/schema.generated.js';
import type { Pet as PetSchema } from '../schemas/pet.js';

type Pet = Infer<typeof PetSchema>;
type PetRow = InferRow<typeof pets>;
type PetInsert = InferInsert<typeof pets>;

export class PetRepository {
  constructor(private readonly db: Db) {}

  async create(input: { name: string; species: Pet['species']; age: number }): Promise<Pet> {
    const row = await this.db.insert(pets).values({
      id: crypto.randomUUID(),
      name: input.name,
      species: input.species,
      age: input.age,
      createdAt: new Date().toISOString(),
    }).returning().get();
    return this.rowToApi(row);
  }

  private rowToApi(row: PetRow): Pet {
    return {
      id: row.id,
      name: row.name,
      species: row.species,
      age: row.age,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
```

The repository is the **one and only** place where row shapes meet API shapes. Handlers never touch `pets`; tests never touch `pets`; OpenAPI never sees `pets`. This is the whole point of the repository boundary. See `examples/petstore/src/repositories/pet.ts` for the full implementation including Money value-object mapping and JSON-encoded tags.

### Per-scenario DB isolation

```ts
// src/test-setup.ts
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

export default function createTestServices() {
  const db = createDatabase(':memory:');
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() { services.db.$raw.close(); },
  };
}
```

Every scenario gets a fresh in-memory SQLite database. The test runner calls this factory before every scenario and `cleanup()` after. See [`docs/ai-agent-guide.md` §6.2](../ai-agent-guide.md#62-per-scenario-isolation-test-setup).

### When to hand-write vs generate

- **Greenfield**: generate. You get the schema for free, dialect switching is one flag, and the hints live next to the field they describe.
- **Existing database**: hand-write the Drizzle schema and skip `.storage(...)` on the Triad models. The bridge is designed for schemas born in Triad; retrofitting it onto an existing database is more work than just writing the Drizzle file yourself.
- **Complex constraints** (partial indexes, materialized views, generated columns): hand-write. The bridge targets the common 90% case; the long tail is Drizzle's native syntax.

For the full discussion (including why Triad chose Drizzle over Prisma, the "two schemas, one language" argument, and migration workflow), read [`docs/drizzle-integration.md`](../drizzle-integration.md).

---

## 3. Path B — Drizzle without the bridge

You want Drizzle, but you do not want Triad's codegen. Maybe the tables already exist. Maybe you want to tune column types by hand. Maybe you just do not like `triad db generate` as a workflow step.

Skip `@triad/drizzle` entirely:

```bash
npm install @triad/core drizzle-orm better-sqlite3
# NOT needed: @triad/drizzle
```

Write `src/db/schema.ts` yourself:

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pets = sqliteTable('pets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  species: text('species', { enum: ['dog', 'cat', 'bird', 'fish'] }).notNull(),
  age: integer('age').notNull(),
  status: text('status').notNull().default('available'),
  createdAt: text('created_at').notNull(),
});
```

Drop `.storage(...)` from your Triad models — the annotations do nothing without the bridge, so keeping them is misleading:

```ts
export const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  name: t.string().minLength(1).maxLength(100),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
  status: t.enum('available', 'adopted', 'pending').default('available'),
  createdAt: t.datetime(),
});
```

The repository pattern is identical. You can still use Drizzle's native `InferModel<typeof pets>` for row typing — you just do not get Triad's `InferRow` / `InferInsert` re-exports.

**What you lose**: `triad db generate`, dialect switching, and the `.storage()` metadata workflow.
**What you keep**: everything else — Drizzle's type safety, the repository boundary, per-scenario isolation, and the fact that Triad handlers never know which ORM you picked.

---

## 4. Path C — Prisma

Prisma works. The mechanics are the same as Drizzle: you have a row layer, a repository that translates rows to API shapes, and a service container that exposes the repository.

### Install and model

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init --datasource-provider sqlite
```

`prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Book {
  id         String   @id @default(uuid())
  title      String
  authorId   String
  priceCents Int
  createdAt  DateTime @default(now())
  author     User     @relation(fields: [authorId], references: [id])
}

model User {
  id    String @id @default(uuid())
  email String @unique
  name  String
  books Book[]
}
```

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### Repository

```ts
// src/repositories/book.ts
import { PrismaClient } from '@prisma/client';
import type { Infer } from '@triad/core';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;

export interface CreateBookInput {
  title: string;
  authorId: string;
  priceCents: number;
}

export class BookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateBookInput): Promise<Book> {
    const row = await this.prisma.book.create({
      data: {
        title: input.title,
        authorId: input.authorId,
        priceCents: input.priceCents,
      },
    });
    return this.rowToApi(row);
  }

  async findById(id: string): Promise<Book | null> {
    const row = await this.prisma.book.findUnique({ where: { id } });
    return row ? this.rowToApi(row) : null;
  }

  private rowToApi(row: {
    id: string;
    title: string;
    authorId: string;
    priceCents: number;
    createdAt: Date;
  }): Book {
    return {
      id: row.id,
      title: row.title,
      authorId: row.authorId,
      priceCents: row.priceCents,
      createdAt: row.createdAt.toISOString(),   // Prisma Date → Triad ISO string
    };
  }
}
```

Two gotchas to notice in `rowToApi`:

1. **Prisma emits `Date` objects** for `DateTime` columns. Triad's `t.datetime()` is a string (ISO 8601). Convert with `.toISOString()` at the repository boundary. Do not let `Date` objects leak into handlers.
2. **Prisma's `Decimal` type** (not shown here) is its own class. If you use `Decimal` columns for money, convert at the boundary too — `.toString()` or `Number(...)` depending on your Triad schema.

### Service container

```ts
// src/services.ts
import { PrismaClient } from '@prisma/client';
import { BookRepository } from './repositories/book.js';

export interface AppServices {
  prisma: PrismaClient;
  bookRepo: BookRepository;
}

declare module '@triad/core' {
  interface ServiceContainer extends AppServices {}
}

export function createServices({ databaseUrl }: { databaseUrl: string }): AppServices {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, bookRepo: new BookRepository(prisma) };
}
```

### Per-test isolation

Two viable strategies:

**Fresh SQLite file per scenario**: simplest and bulletproof. Write the test setup to create a temp DB file, point `DATABASE_URL` at it, run `prisma migrate deploy` once, and delete the file in cleanup.

```ts
// src/test-setup.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createServices } from './services.js';

export default function createTestServices() {
  const dir = mkdtempSync(join(tmpdir(), 'bookshelf-'));
  const dbPath = join(dir, 'test.db');
  const url = `file:${dbPath}`;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  const services = createServices({ databaseUrl: url });
  return {
    ...services,
    async cleanup() {
      await services.prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

**Shared DB + transaction rollback**: faster but requires Prisma's `$transaction` API and careful cleanup. Not covered here — see Prisma's own docs.

### Prisma-specific caveats

- **Migrations are not tied to Triad.** `prisma migrate` runs independently of `triad db generate` (which you are not using on this path). If you change a Triad model, you must also update `schema.prisma` by hand.
- **Enums**: Prisma enums and Triad enums are parallel worlds. Keep the values in sync manually, or derive them in one file and reference both.
- **Decimal for money**: Prisma's `Decimal` is not JSON-safe. Convert at the repository boundary.
- **The Prisma client is large.** On edge runtimes, prefer the Data Proxy or Prisma Accelerate.

---

## 5. Path D — Kysely

Kysely is philosophically closer to Drizzle: a type-safe query builder, not an ORM. It pairs well with Triad because both are schema-in-code and neither wants to own your types.

```bash
npm install kysely better-sqlite3
npm install -D @types/better-sqlite3
```

### Database interface

```ts
// src/db/types.ts
import type { Generated, ColumnType } from 'kysely';

export interface Database {
  books: BooksTable;
  users: UsersTable;
}

export interface BooksTable {
  id: string;
  title: string;
  author_id: string;
  price_cents: number;
  created_at: ColumnType<string, string, never>;
}

export interface UsersTable {
  id: string;
  email: string;
  name: string;
}
```

### Client

```ts
// src/db/client.ts
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database } from './types.js';

export function createDatabase(url: string) {
  const raw = new SQLite(url);
  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: raw }) });
  return Object.assign(db, { $raw: raw });
}
export type Db = ReturnType<typeof createDatabase>;
```

### Repository

```ts
import type { Db } from '../db/client.js';
import type { Infer } from '@triad/core';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;

export class BookRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Book | null> {
    const row = await this.db
      .selectFrom('books')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.rowToApi(row) : null;
  }

  private rowToApi(row: {
    id: string;
    title: string;
    author_id: string;
    price_cents: number;
    created_at: string;
  }): Book {
    return {
      id: row.id,
      title: row.title,
      authorId: row.author_id,           // snake_case → camelCase
      priceCents: row.price_cents,
      createdAt: row.created_at,
    };
  }
}
```

Kysely does not ship a migration tool. Use `kysely-migration-cli`, `dbmate`, or write migrations by hand. As with Prisma, migrations are independent of Triad — if you prefer one tool to rule them all, pair Kysely with the `@triad/drizzle` bridge used purely for schema emission, then point Kysely at the same tables.

Isolation: fresh `:memory:` database per scenario in `test-setup.ts`, identical to the Drizzle pattern.

---

## 6. Path E — Raw SQL

Sometimes SQL is the right answer. Triad does not care.

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

```ts
// src/repositories/book.ts
import Database from 'better-sqlite3';
import type { Infer } from '@triad/core';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;

export class BookRepository {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author_id TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  create(input: { id: string; title: string; authorId: string; priceCents: number }): Book {
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO books (id, title, author_id, price_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(input.id, input.title, input.authorId, input.priceCents, now);
    return { ...input, createdAt: now };
  }

  findById(id: string): Book | null {
    const row = this.db.prepare(
      'SELECT id, title, author_id AS authorId, price_cents AS priceCents, created_at AS createdAt FROM books WHERE id = ?',
    ).get(id) as Book | undefined;
    return row ?? null;
  }
}
```

Notice the `AS` aliases in the SELECT — the repository pushes the snake-to-camel conversion into SQL. Other valid strategies: convert in JS, or use snake_case everywhere and match it in the Triad model.

For Postgres, swap `better-sqlite3` for `pg` and use parameterized queries (`$1`, `$2`). For MySQL, `mysql2/promise`. None of this changes anything upstream of the repository.

---

## 7. What you lose without the Drizzle bridge

| Feature | With `@triad/drizzle` | Without |
|---|---|---|
| `triad db generate` | Yes | No |
| `.storage(...)` metadata is meaningful | Yes | Ignored (keep off models for clarity) |
| `InferRow` / `InferInsert` helpers | Yes | Use the ORM's own inference |
| Dialect switch via a CLI flag | Yes | Rewrite the schema by hand |
| Schema codegen living next to API schemas | Yes | Two files to keep mentally in sync |

What you keep (on every path):

- The repository pattern.
- The service container and `declare module '@triad/core'` augmentation.
- Per-scenario isolation via `test-setup.ts`.
- `triad test` running scenarios in-process against real handlers.
- The OpenAPI / Gherkin / AsyncAPI output — these come from the Triad router, not the storage layer.

---

## 8. Decision tree

```
Do you already have a preferred ORM?
├── No → Drizzle + @triad/drizzle (Path A).
│       This is the default; every example in the repo uses it.
│
└── Yes
    ├── Drizzle but I want to write schemas by hand → Path B.
    │
    ├── Prisma → Path C.
    │   Skip @triad/drizzle. Keep Prisma migrations separate.
    │   Convert Date and Decimal at the repository boundary.
    │
    ├── Kysely → Path D.
    │   Skip @triad/drizzle (or use it for schema emission only and
    │   point Kysely at the emitted tables).
    │
    ├── TypeORM / Sequelize / MikroORM → treat like Prisma (Path C).
    │   Bridge via repositories. Keep migrations in the ORM's own tool.
    │
    └── Raw SQL / better-sqlite3 / pg / mysql2 → Path E.
        Repository holds the prepared statements.
```

---

## 9. FAQ

**Can I use Drizzle AND Prisma in the same app?**
Technically yes, for different tables. Practically this is a smell — it doubles your type footprint, splits your migrations across two tools, and confuses anyone reading the repository. Pick one.

**Does Triad support NoSQL (Mongo, DynamoDB, Firestore)?**
No first-party bridge, but repositories are user code. Write `BookRepository` with the Mongo driver, expose it on `ctx.services`, done. The only thing to watch is that `rowToApi` has to convert Mongo's `ObjectId` and `Date` types into the strings Triad's `t.string()` and `t.datetime()` expect.

**What about edge-runtime databases (D1, Turso, Neon, PlanetScale)?**
All of these work. Use an HTTP-friendly driver (`@libsql/client`, `@cloudflare/workers-types` + `D1Database`, `@neondatabase/serverless`, `@planetscale/database`) inside a per-request services factory. Pair with `@triad/hono` for the adapter; see [Choosing an adapter §4](./choosing-an-adapter.md#4-hono-setup).

**Do migrations belong in Triad?**
No. Triad's job is the API contract; the storage contract is yours. Use `drizzle-kit`, `prisma migrate`, `dbmate`, Flyway, or whatever your team already runs. `triad db generate` regenerates *schemas*, not migrations — on purpose.

**Can I mix ORMs across bounded contexts?**
Yes, but it rarely makes sense. A bounded context is a DDD concept, not a persistence boundary. If you genuinely have two databases, model it as two service containers (or two Triad routers) rather than two ORMs in one container.

**What does the Triad test runner need from my ORM?**
Nothing specific. It calls `createTestServices()` before every scenario and `cleanup()` after. Whatever happens inside those two functions is your choice — an in-memory SQLite, a fresh file, a transaction that rolls back, a Docker-managed Postgres with `TRUNCATE` between tests. All valid.
