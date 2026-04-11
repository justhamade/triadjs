# Step 4 — Persistence with Drizzle

**Goal:** replace the in-memory `BookRepository` with a Drizzle + better-sqlite3 implementation. Add `.storage()` hints to the `Book` model so `triad db generate` can emit the same Drizzle schema you wrote by hand. Learn per-scenario database isolation, `triad db migrate`, and when to hand-write vs generate the schema.

No handler changes. No endpoint changes. Not a single scenario is rewritten. The repository interface from [step 2](02-crud-api.md) is the seam you lean on — swap the implementation, keep everything else.

## 1. Install the data layer

```bash
npm install @triad/drizzle drizzle-orm better-sqlite3
npm install -D @types/better-sqlite3
```

Triad's Drizzle bridge is a **codegen tool**, not a runtime. It reads `.storage()` hints from your models and emits a Drizzle schema file. You still write your repositories against Drizzle directly — Triad does not sit between your handler and your query builder.

## 2. Hand-write the Drizzle schema (Option A)

For this step, we will write the Drizzle schema manually first, understand every column, and then in section 8 switch to the generator. Writing it once by hand teaches you what the codegen is producing.

Create `src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable('books', {
  id: text('id').primaryKey().notNull(),
  title: text('title').notNull(),
  author: text('author').notNull(),
  isbn: text('isbn'),
  publishedYear: integer('published_year').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

Two conventions worth flagging:

- **`text` for ISO datetimes.** SQLite has no native datetime type; Triad's bridge stores `t.datetime()` as ISO-8601 text. Postgres gets a real `timestamp`. See [AI agent guide §10.3](../ai-agent-guide.md#103-dialects) for the full type-mapping table.
- **Snake-case column names, camelCase JS fields.** The repository's mapping layer translates.

## 3. A database client factory

Create `src/db/client.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & {
  readonly $raw: Database.Database;
};

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  published_year INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export function createDatabase(url: string = ':memory:'): Db {
  const sqlite = new Database(url);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema });
  return Object.assign(db, { $raw: sqlite });
}
```

Three decisions to call out:

1. **`:memory:` as the default.** The factory works with zero config for tests and local dev. Set `DATABASE_URL=./bookshelf.db` to persist across restarts.
2. **Inline DDL via `INIT_SQL`.** For a tutorial this is the lowest-ceremony path — the table is created on every connection, so an in-memory DB is self-initializing. A production project would run real migrations. Section 9 covers `triad db migrate`.
3. **`$raw` escape hatch.** Attached as a non-Drizzle property so `server.ts` and `test-setup.ts` can close the connection on shutdown without importing `better-sqlite3` directly.

## 4. Rewrite the repository

Replace `src/repositories/book.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';

import type { Db } from '../db/client.js';
import { books } from '../db/schema.js';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;
type BookRow = typeof books.$inferSelect;
type BookInsert = typeof books.$inferInsert;

export interface CreateBookInput {
  title: string;
  author: string;
  isbn?: string;
  publishedYear: number;
}

export interface UpdateBookInput {
  title?: string;
  author?: string;
}

export interface ListBooksOptions {
  limit: number;
  offset: number;
}

export class BookRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: BookRow): Book {
    const book: Book = {
      id: row.id,
      title: row.title,
      author: row.author,
      publishedYear: row.publishedYear,
      createdAt: row.createdAt,
    };
    if (row.isbn !== null) {
      book.isbn = row.isbn;
    }
    return book;
  }

  private apiToRow(input: CreateBookInput): BookInsert {
    return {
      id: crypto.randomUUID(),
      title: input.title,
      author: input.author,
      isbn: input.isbn ?? null,
      publishedYear: input.publishedYear,
      createdAt: new Date().toISOString(),
    };
  }

  async create(input: CreateBookInput): Promise<Book> {
    const row = this.apiToRow(input);
    this.db.insert(books).values(row).run();
    return this.rowToApi(row as BookRow);
  }

  async findById(id: string): Promise<Book | null> {
    const row = this.db.select().from(books).where(eq(books.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async list(options: ListBooksOptions): Promise<Book[]> {
    const rows = this.db
      .select()
      .from(books)
      .orderBy(asc(books.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all();
    return rows.map((r) => this.rowToApi(r));
  }

  async update(id: string, patch: UpdateBookInput): Promise<Book | null> {
    const updates: Partial<BookInsert> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.author !== undefined) updates.author = patch.author;
    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }
    const result = this.db
      .update(books)
      .set(updates)
      .where(eq(books.id, id))
      .run();
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.delete(books).where(eq(books.id, id)).run();
    return result.changes > 0;
  }
}
```

The external interface is **identical** to the in-memory version from step 2. Same method names, same parameters, same return types. The only difference is two private helpers — `rowToApi` and `apiToRow` — that translate between the storage contract and the API contract.

> **Why a translation layer?** The rows you select from SQLite are not API-shaped. `isbn` is `string | null` in the row but `string | undefined` in the API model (because `CreateBook` uses `.optional()`, not `.nullable()`). `createdAt` is a `text` column in Postgres terms but a `datetime` semantically in Triad. If you skip the helpers and return rows straight out of the query, the shapes will drift over time and you'll have bugs where JSON serialization does the wrong thing silently. Two private methods is the cheapest way to put the mapping in exactly one place.

## 5. Update services to take a `db` dependency

Replace `src/services.ts`:

```ts
import { createDatabase, type Db } from './db/client.js';
import { BookRepository } from './repositories/book.js';

export interface BookshelfServices {
  db: Db;
  bookRepo: BookRepository;
}

declare module '@triad/core' {
  interface ServiceContainer extends BookshelfServices {}
}

export interface CreateServicesOptions {
  db?: Db;
}

export function createServices(
  options: CreateServicesOptions = {},
): BookshelfServices {
  const db = options.db ?? createDatabase();
  return {
    db,
    bookRepo: new BookRepository(db),
  };
}
```

The optional `db` parameter is the canonical dependency-injection pattern: the production entry point passes a file-backed database, the test setup passes a fresh in-memory database per scenario, and nothing inside the repositories has to know which one it is.

## 6. Per-scenario database isolation

Replace `src/test-setup.ts`:

```ts
import { createServices, type BookshelfServices } from './services.js';
import { createDatabase } from './db/client.js';

interface TestServices extends BookshelfServices {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const db = createDatabase(':memory:');
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() {
      services.db.$raw.close();
    },
  };
}
```

Each call to this factory opens a **new** in-memory SQLite database. `createDatabase()` runs the `CREATE TABLE` DDL, so the new connection starts with a complete, empty schema in a couple of milliseconds. After each scenario, `cleanup()` closes the connection and the memory is released.

This is the cleanest form of test isolation: no truncation, no transaction rollbacks, no shared state between scenarios. Bugs like "I forgot to handle NULL in the WHERE clause" surface the same way they would in production because the test runs against real SQL.

Run:

```bash
npx triad test
```

All six scenarios from step 2 and the new negative scenario from step 3 still pass — **seven green** — but they now exercise real SQL, real enum constraints, real NOT NULL checks. Nothing in `src/endpoints/books.ts` had to change.

## 7. Update the server

Update `src/server.ts` to take the database URL from the environment:

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const app = Fastify({ logger: true });

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

await app.register(triadPlugin, { router, services });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.$raw.close();
    process.exit(0);
  });
}
```

This is almost the final version of `server.ts` — [step 7](07-production.md) tightens the logging and config story, but the shape is already right.

```bash
DATABASE_URL=./bookshelf.db npm start
curl -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"title":"The Name of the Wind","author":"Patrick Rothfuss","publishedYear":2007}'
curl http://localhost:3000/books
```

Now `bookshelf.db` exists on disk and survives restarts.

## 8. Generate the Drizzle schema (Option B)

Now that you have a working hand-written Drizzle schema, you can delete most of it. Add `.storage()` hints to `src/schemas/book.ts`:

```ts
import { t } from '@triad/core';

export const Book = t.model('Book', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique book identifier'),
  title: t
    .string()
    .minLength(1)
    .maxLength(200)
    .storage({ indexed: true })
    .doc('Book title')
    .example('The Pragmatic Programmer'),
  author: t
    .string()
    .minLength(1)
    .maxLength(200)
    .storage({ indexed: true })
    .doc('Author name')
    .example('Andy Hunt'),
  isbn: t
    .string()
    .pattern(/^[0-9-]{10,17}$/)
    .optional()
    .storage({ unique: true })
    .doc('ISBN-10 or ISBN-13'),
  publishedYear: t
    .int32()
    .min(1000)
    .max(2100)
    .storage({ columnName: 'published_year' })
    .doc('Year of first publication'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, columnName: 'created_at' })
    .doc('When this book was added to the shelf'),
});

export const CreateBook = Book
  .pick('title', 'author', 'isbn', 'publishedYear')
  .named('CreateBook');

export const UpdateBook = Book
  .pick('title', 'author')
  .partial()
  .named('UpdateBook');
```

`.identity()` and `.storage({ primaryKey: true })` are **different**. `.identity()` is a DDD marker — the field is the entity's identity — and emits an `x-triad-identity` extension in OpenAPI. `.storage({ primaryKey: true })` is a persistence hint for the Drizzle bridge. Most real entities want both on the same field.

Now run the generator:

```bash
npx triad db generate --dialect sqlite --output ./src/db/schema.generated.ts
```

Open `src/db/schema.generated.ts` — it contains the same `sqliteTable('books', { ... })` you wrote by hand, with snake_case column names derived from your `columnName` hints and indices derived from `indexed: true`. Swap your imports in `src/db/client.ts`:

```ts
import * as schema from './schema.generated.js';
```

And delete `src/db/schema.ts`. The tests still pass. You now have exactly one source of truth for the shape of a book: `src/schemas/book.ts`.

> **When to hand-write vs generate.** The generator is right 95% of the time. Reach for hand-written schemas when you need dialect-specific features the bridge doesn't expose yet (partial indexes, generated columns, `GIN` indexes on Postgres `jsonb`) or when the table is a pure join table with no matching Triad model. For everything else, the generator is the straight line.
>
> Even when you hand-write, commit the `.storage()` hints on your models anyway — they flow into OpenAPI as metadata and document "this field is the primary key" for readers.

## 9. Migrations

`triad db migrate` diffs your current router against a previous snapshot and emits a migration script you can execute with `drizzle-kit` or apply manually:

```bash
npx triad db migrate
```

The output is a plain SQL file under `./migrations/`. The first run is an initial migration containing every table; subsequent runs are diffs. See [AI agent guide §7.4](../ai-agent-guide.md#74-triad-db-generate) and `packages/drizzle/src/codegen/` for the current shape of the diff output.

For production, commit the emitted SQL files, run them with your migration runner of choice (drizzle-kit, a hand-rolled CI step, or a migrate-on-startup hook), and remove the `INIT_SQL` block from `db/client.ts`. The tutorial keeps `INIT_SQL` for simplicity so `:memory:` tests don't need a separate migration step.

## Sidebar: What if I don't want Drizzle?

Triad has no runtime dependency on Drizzle. The `@triad/drizzle` package is a **codegen-only** bridge; nothing in `@triad/core`, `@triad/fastify`, or the test runner imports it. If you want Prisma, Knex, pg-promise, or a hand-rolled pool, just write your repository against that instead — the handlers don't care.

The one thing you lose is the `triad db generate` codegen path. Your repositories become the single source of truth for the storage shape, and your OpenAPI stays clean because it's derived from the Triad schemas regardless of what's behind the repository. For a fuller discussion, see [`docs/guides/choosing-an-orm.md`](../guides/choosing-an-orm.md).

## Next up

[Step 5 — Authentication](05-authentication.md). Right now anyone can read or write any book. You will add a `User` entity, registration and login endpoints, a `requireAuth` beforeHandler, and ownership checks so users can only touch their own books. This is where the `beforeHandler` hook and `checkOwnership` from `@triad/core` come in.
