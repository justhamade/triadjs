# Step 2 — CRUD API

**Goal:** replace the hello endpoint with five real endpoints for managing books. Introduce the repository pattern, `ServiceContainer` module augmentation, bounded contexts, and derived models. The database is still a `Map` in memory — [step 4](04-persistence.md) swaps it for SQLite.

By the end of this step, Bookshelf has a working `POST /books`, `GET /books`, `GET /books/:id`, `PATCH /books/:id`, `DELETE /books/:id`, tested end-to-end.

## 1. Define the `Book` model

Create `src/schemas/book.ts`:

```ts
import { t } from '@triad/core';

export const Book = t.model('Book', {
  id: t.string().format('uuid').identity().doc('Unique book identifier'),
  title: t.string().minLength(1).maxLength(200).doc('Book title').example('The Pragmatic Programmer'),
  author: t.string().minLength(1).maxLength(200).doc('Author name').example('Andy Hunt'),
  isbn: t.string().pattern(/^[0-9-]{10,17}$/).optional().doc('ISBN-10 or ISBN-13'),
  publishedYear: t.int32().min(1000).max(2100).doc('Year of first publication'),
  createdAt: t.datetime().doc('When this book was added to the shelf'),
});

export const CreateBook = Book
  .pick('title', 'author', 'isbn', 'publishedYear')
  .named('CreateBook');

export const UpdateBook = Book
  .pick('title', 'author')
  .partial()
  .named('UpdateBook');
```

Four things to notice:

- **`.identity()`** marks `id` as the entity's identity field. In DDD terms, `Book` is an aggregate root and `id` is its identity. Triad emits an `x-triad-identity` extension in OpenAPI so downstream tools can tell which field is "the" id.
- **`.pick(...)` + `.named(...)`** derives request DTOs from the parent model. `CreateBook` has no `id` or `createdAt` (server-assigned); `UpdateBook` makes every picked field optional via `.partial()`. Always `.named(...)` when deriving — otherwise the OpenAPI component inherits the parent's name and collides.
- **`.optional()` on `isbn`** means "this field may be absent on input and output". It does NOT mean nullable. If you want `null`, chain `.nullable()`.
- **No storage hints yet.** `.storage({...})` is for the Drizzle bridge and enters in [step 4](04-persistence.md).

Create a shared error envelope at `src/schemas/common.ts`:

```ts
import { t } from '@triad/core';

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});
```

Use one `ApiError` model for every failure response across every endpoint. Consistency pays off once clients start parsing errors.

## 2. Write a repository

Handlers should not talk to storage directly. Put the storage logic in a class that exposes a small set of domain-shaped methods, and inject it via `ctx.services`.

Create `src/repositories/book.ts`:

```ts
import type { Infer } from '@triad/core';
import type { Book as BookSchema } from '../schemas/book.js';

type Book = Infer<typeof BookSchema>;

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
  private readonly books = new Map<string, Book>();

  async create(input: CreateBookInput): Promise<Book> {
    const book: Book = {
      id: crypto.randomUUID(),
      title: input.title,
      author: input.author,
      publishedYear: input.publishedYear,
      createdAt: new Date().toISOString(),
      ...(input.isbn !== undefined && { isbn: input.isbn }),
    };
    this.books.set(book.id, book);
    return book;
  }

  async findById(id: string): Promise<Book | null> {
    return this.books.get(id) ?? null;
  }

  async list(options: ListBooksOptions): Promise<Book[]> {
    const all = [...this.books.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
    return all.slice(options.offset, options.offset + options.limit);
  }

  async update(id: string, patch: UpdateBookInput): Promise<Book | null> {
    const existing = this.books.get(id);
    if (!existing) return null;
    const updated: Book = {
      ...existing,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.author !== undefined && { author: patch.author }),
    };
    this.books.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.books.delete(id);
  }
}
```

> **Why the repository?** A handler whose first line does a `SELECT` has leaked storage into the transport layer. The same endpoint is then untestable without a database, impossible to reuse with a different store, and scattered in a way that makes the domain model hard to see. Pushing the SQL behind a named interface keeps the handler a thin adapter between HTTP and the domain, and the repository becomes a natural seam for the test runner to swap implementations.
>
> Triad leans on this pattern hard. Every example in the repo looks the same: handlers never touch `db`, repositories never touch `ctx`. You will thank yourself when you swap the in-memory `Map` for Drizzle in [step 4](04-persistence.md) and not one handler line changes.
>
> The second reason is that the test runner is in-process. When `triad test` runs a scenario, it constructs a `HandlerContext` with a fresh `services` object and calls the handler directly. The repository is the one place your production and test code share a surface.

## 3. Wire services

Create `src/services.ts`:

```ts
import { BookRepository } from './repositories/book.js';

export interface BookshelfServices {
  bookRepo: BookRepository;
}

declare module '@triad/core' {
  interface ServiceContainer extends BookshelfServices {}
}

export function createServices(): BookshelfServices {
  return {
    bookRepo: new BookRepository(),
  };
}
```

The `declare module` block is the crucial piece. It tells the TypeScript compiler that `ctx.services.bookRepo` exists and has the correct type **in every handler, without any imports**. If you skip this, `ctx.services` is the empty container type and every access is a compile error. Do it once per project.

## 4. Write the endpoints

Create `src/endpoints/books.ts`:

```ts
import { endpoint, scenario, t } from '@triad/core';
import { Book, CreateBook, UpdateBook } from '../schemas/book.js';
import { ApiError } from '../schemas/common.js';

// POST /books — create
export const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Add a book to the shelf',
  tags: ['Library'],
  request: { body: CreateBook },
  responses: {
    201: { schema: Book, description: 'Book created' },
  },
  handler: async (ctx) => {
    const book = await ctx.services.bookRepo.create(ctx.body);
    return ctx.respond[201](book);
  },
  behaviors: [
    scenario('A book can be added with valid details')
      .given('a valid book payload')
      .body({
        title: 'The Pragmatic Programmer',
        author: 'Andy Hunt',
        publishedYear: 1999,
      })
      .when('I POST /books')
      .then('response status is 201')
      .and('response body matches Book')
      .and('response body has title "The Pragmatic Programmer"'),
  ],
});

// GET /books — list
export const listBooks = endpoint({
  name: 'listBooks',
  method: 'GET',
  path: '/books',
  summary: 'List books on the shelf',
  tags: ['Library'],
  request: {
    query: {
      limit: t.int32().min(1).max(100).default(20).doc('Page size'),
      offset: t.int32().min(0).default(0).doc('Page offset'),
    },
  },
  responses: {
    200: { schema: t.array(Book), description: 'List of books' },
  },
  handler: async (ctx) => {
    const books = await ctx.services.bookRepo.list({
      limit: ctx.query.limit,
      offset: ctx.query.offset,
    });
    return ctx.respond[200](books);
  },
  behaviors: [
    scenario('All books are returned when none are filtered out')
      .given('two books exist')
      .setup(async (services) => {
        await services.bookRepo.create({
          title: 'Book One',
          author: 'Author A',
          publishedYear: 2001,
        });
        await services.bookRepo.create({
          title: 'Book Two',
          author: 'Author B',
          publishedYear: 2002,
        });
      })
      .when('I GET /books')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 2'),
  ],
});

// GET /books/:id — read one
export const getBook = endpoint({
  name: 'getBook',
  method: 'GET',
  path: '/books/:id',
  summary: 'Fetch a book by id',
  tags: ['Library'],
  request: {
    params: { id: t.string().format('uuid') },
  },
  responses: {
    200: { schema: Book, description: 'Book found' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const book = await ctx.services.bookRepo.findById(ctx.params.id);
    if (!book) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No book with id ${ctx.params.id}.`,
      });
    }
    return ctx.respond[200](book);
  },
  behaviors: [
    scenario('An existing book can be retrieved by id')
      .given('a book exists')
      .setup(async (services) => {
        const book = await services.bookRepo.create({
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        return { bookId: book.id };
      })
      .params({ id: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 200')
      .and('response body has title "Dune"'),

    scenario('Unknown ids return 404')
      .given('no book exists with the requested id')
      .fixtures({ bookId: '00000000-0000-0000-0000-000000000000' })
      .params({ id: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

// PATCH /books/:id — update
export const updateBook = endpoint({
  name: 'updateBook',
  method: 'PATCH',
  path: '/books/:id',
  summary: 'Update a book',
  tags: ['Library'],
  request: {
    params: { id: t.string().format('uuid') },
    body: UpdateBook,
  },
  responses: {
    200: { schema: Book, description: 'Book updated' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const updated = await ctx.services.bookRepo.update(ctx.params.id, ctx.body);
    if (!updated) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No book with id ${ctx.params.id}.`,
      });
    }
    return ctx.respond[200](updated);
  },
  behaviors: [
    scenario('An existing book can be updated')
      .given('a book exists')
      .setup(async (services) => {
        const book = await services.bookRepo.create({
          title: 'The Hobbit',
          author: 'J. R. R. Tolkien',
          publishedYear: 1937,
        });
        return { bookId: book.id };
      })
      .params({ id: '{bookId}' })
      .body({ title: 'The Hobbit (Illustrated)' })
      .when('I PATCH /books/{bookId}')
      .then('response status is 200')
      .and('response body has title "The Hobbit (Illustrated)"'),
  ],
});

// DELETE /books/:id — delete
export const deleteBook = endpoint({
  name: 'deleteBook',
  method: 'DELETE',
  path: '/books/:id',
  summary: 'Remove a book from the shelf',
  tags: ['Library'],
  request: {
    params: { id: t.string().format('uuid') },
  },
  responses: {
    204: { schema: t.empty(), description: 'Book deleted' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const deleted = await ctx.services.bookRepo.delete(ctx.params.id);
    if (!deleted) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No book with id ${ctx.params.id}.`,
      });
    }
    return ctx.respond[204]();
  },
  behaviors: [
    scenario('An existing book can be deleted')
      .given('a book exists')
      .setup(async (services) => {
        const book = await services.bookRepo.create({
          title: 'Ephemeral',
          author: 'Nobody',
          publishedYear: 2020,
        });
        return { bookId: book.id };
      })
      .params({ id: '{bookId}' })
      .when('I DELETE /books/{bookId}')
      .then('response status is 204'),
  ],
});
```

A few notes on what you just wrote:

- Every endpoint declares exactly the status codes it can produce. Typing `ctx.respond[500](...)` when 500 isn't declared is a **compile error** — the `respond` map is derived from the `responses` config.
- `ctx.body` on `createBook` is typed as `{ title: string; author: string; isbn?: string; publishedYear: number }` purely from `CreateBook`. No imports, no type parameters.
- The 204 response uses `t.empty()` — a first-class primitive for bodyless responses. The `ctx.respond[204]` type narrows to a zero-argument function, the OpenAPI generator omits `content` entirely, and all three adapters skip the `Content-Type` header. See the [AI agent guide §3.5](../ai-agent-guide.md#35-common-patterns).
- `setup()` returns a fixtures bag. The `{bookId}` placeholder in `.params({ id: '{bookId}' })` is substituted at scenario run time. [Step 3](03-testing.md) covers this in depth.

## 5. Group into a bounded context

Create `src/app.ts`:

```ts
import { createRouter } from '@triad/core';
import {
  createBook,
  listBooks,
  getBook,
  updateBook,
  deleteBook,
} from './endpoints/books.js';
import { Book, CreateBook, UpdateBook } from './schemas/book.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Bookshelf API',
  version: '0.2.0',
  description: 'A personal book-collection API',
});

router.context(
  'Library',
  {
    description: 'Catalog of books on the shelf.',
    models: [Book, CreateBook, UpdateBook, ApiError],
  },
  (ctx) => {
    ctx.add(createBook, listBooks, getBook, updateBook, deleteBook);
  },
);

export default router;
```

A `router.context('Library', ...)` does three things:

1. **Groups endpoints in generated Gherkin output** — one `.feature` file per context.
2. **Declares the context's ubiquitous language** via `models[]`. `triad validate` warns if an endpoint inside `Library` references a model that isn't listed.
3. **Can hold both HTTP endpoints and WebSocket channels** — [step 6](06-websockets.md) adds a channel to this same context.

This is the first glimmer of DDD in your tutorial app. A bounded context names a subdomain of your system; for a tiny app there's only one. Larger apps split along fault lines — Catalog, Reviews, Accounts, Billing — and Triad enforces that split at the model level.

## 6. Update the config and run

Your `triad.config.ts` needs a test setup module now, because behaviors call `services.bookRepo.create(...)` in `.setup()`:

```ts
import { defineConfig } from '@triad/test-runner';

export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
  docs: {
    output: './generated/openapi.yaml',
  },
  gherkin: {
    output: './generated/features',
  },
});
```

Create `src/test-setup.ts`:

```ts
import { createServices, type BookshelfServices } from './services.js';

interface TestServices extends BookshelfServices {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const services = createServices();
  return {
    ...services,
    async cleanup() {
      // In-memory map — nothing to close. Step 4 adds real cleanup.
    },
  };
}
```

The CLI calls this factory **before every scenario** and `cleanup()` **after every scenario**. Each test gets a fresh `BookRepository` with an empty map. No cross-test leakage.

Update `src/server.ts` to pass the services to the Fastify plugin:

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createServices } from './services.js';

const app = Fastify({ logger: true });

await app.register(triadPlugin, {
  router,
  services: createServices(),
});

await app.listen({ port: 3000, host: '0.0.0.0' });
```

Run the suite:

```bash
npx triad test
```

You should see six passing scenarios (one create, one list, two get, one update, one delete). Try breaking one — change `"Dune"` to `"dune"` in an assertion — and watch the runner report exactly which scenario and assertion failed.

Generate docs:

```bash
npx triad docs
```

Look at the `/books/{id}` DELETE operation in `generated/openapi.yaml` — the 204 response is emitted correctly:

```yaml
/books/{id}:
  delete:
    operationId: deleteBook
    summary: Remove a book from the shelf
    tags: [Library]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '204':
        description: Book deleted
      '404':
        description: Book not found
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ApiError'
```

Run it over HTTP:

```bash
npm start
# in another terminal:
curl -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -d '{"title":"Dune","author":"Frank Herbert","publishedYear":1965}'
curl http://localhost:3000/books
```

## Next up

[Step 3 — Testing](03-testing.md). You have scenarios now; step 3 digs into exactly how they work: fixtures, placeholder substitution, the assertion phrase parser, and how to debug a scenario that refuses to parse.
