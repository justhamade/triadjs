# Step 5 — Authentication and ownership

**Goal:** add user accounts, register/login endpoints, a `requireAuth` beforeHandler, and ownership checks. By the end, books belong to users, and only the owner of a book can read, update, or delete it. Other users see either a 404 or 403 depending on how your product wants to treat existence.

This is the largest conceptual step in the tutorial, because authentication touches every existing endpoint. Take it slow. Nothing here is magic — the pattern is exactly the same as the tasktracker reference example under `examples/tasktracker/`.

## 1. The `User` model

Create `src/schemas/user.ts`:

```ts
import { t } from '@triad/core';

export const User = t.model('User', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique user identifier'),
  email: t
    .string()
    .format('email')
    .storage({ unique: true, indexed: true })
    .doc('Contact / login email')
    .example('alice@example.com'),
  name: t.string().minLength(1).maxLength(100).doc('Display name'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, columnName: 'created_at' })
    .doc('When the account was created'),
});

export const RegisterInput = t.model('RegisterInput', {
  email: t.string().format('email').doc('Login email'),
  password: t.string().minLength(6).maxLength(200).doc('Plaintext password'),
  name: t.string().minLength(1).maxLength(100).doc('Display name'),
});

export const LoginInput = t.model('LoginInput', {
  email: t.string().format('email').doc('Login email'),
  password: t.string().minLength(1).doc('Plaintext password'),
});

export const AuthResult = t.model('AuthResult', {
  user: User,
  token: t.string().doc('Bearer token. Pass as "Authorization: Bearer <token>" on subsequent requests.'),
});
```

Three design notes:

- **`passwordHash` is NOT on `User`.** The wire representation of a user never leaks the hash. It only exists on the database row. This is the "storage contract vs API contract" split.
- **`RegisterInput` and `LoginInput` are flat `t.model`s, not value objects.** You could argue that `(email, password)` is a classic value object, but wrapping it in `{credentials: {...}}` envelopes every client into a nested structure for no gain. Developer ergonomics wins here.
- **`AuthResult` is a named `t.model`, not an inline shape.** Clients will name this in their own code — `type AuthResult = ...` — so it deserves a stable OpenAPI component.

## 2. A `users` table and hash helpers

Regenerate your Drizzle schema by running `triad db generate` after adding the user model. For clarity here, the manual equivalent of what the generator will emit goes in `src/db/schema.ts` (if you went the generator route in step 4, skip this — the generator handles it):

```ts
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ... (existing `books` table) ...

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

If you use the `INIT_SQL` inline-DDL approach from step 4, add the `CREATE TABLE` for users there too.

Create `src/auth.ts`:

```ts
import { createHash } from 'node:crypto';
import type { BeforeHandler, Infer } from '@triad/core';
import type { User } from './schemas/user.js';
import type { ApiError } from './schemas/common.js';

type UserValue = Infer<typeof User>;

// -----------------------------------------------------------------------
// Password hashing — DO NOT use this in production.
//
// A single SHA-256 pass with a static salt is fast, deterministic, and
// catastrophically wrong for real passwords. A production app must use a
// memory-hard KDF (bcrypt, scrypt, argon2) so that stealing the hash
// table is not equivalent to stealing the passwords.
//
// This tutorial uses SHA-256 because it ships with Node and the point
// of the lesson is Triad's auth *flow*, not password storage.
// -----------------------------------------------------------------------

const STATIC_SALT = 'bookshelf-tutorial-salt';

export function hashPassword(password: string): string {
  return createHash('sha256').update(password + STATIC_SALT).digest('hex');
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  return hashPassword(plaintext) === hash;
}

// -----------------------------------------------------------------------
// Bearer token parsing
// -----------------------------------------------------------------------

export function parseBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1]!.trim() : null;
}

// -----------------------------------------------------------------------
// requireAuth — a reusable beforeHandler for protected endpoints
// -----------------------------------------------------------------------

export type AuthState = { user: UserValue };

type With401<TApiErrorSchema> = {
  401: { schema: TApiErrorSchema; description: string };
};

export const requireAuth: BeforeHandler<
  AuthState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  With401<any>
> = async (ctx) => {
  const token = parseBearer(ctx.rawHeaders['authorization']);
  if (!token) {
    return {
      ok: false,
      response: ctx.respond[401]({
        code: 'UNAUTHENTICATED',
        message: 'Missing or malformed Authorization header.',
      }),
    };
  }
  const userId = ctx.services.tokens.lookup(token);
  if (!userId) {
    return {
      ok: false,
      response: ctx.respond[401]({
        code: 'UNAUTHENTICATED',
        message: 'Token is invalid or has been revoked.',
      }),
    };
  }
  const user = await ctx.services.userRepo.findById(userId);
  if (!user) {
    return {
      ok: false,
      response: ctx.respond[401]({
        code: 'UNAUTHENTICATED',
        message: 'Token refers to a user that no longer exists.',
      }),
    };
  }
  return { ok: true, state: { user } };
};
```

This is the entire auth surface. Every protected endpoint will add `beforeHandler: requireAuth` and `401: { schema: ApiError, description: '...' }` to its responses, and in the handler it will read `ctx.state.user` — typed, without any runtime narrowing.

> **Critical point: the `authorization` header is NOT declared on `request.headers`.**
>
> Before Phase 10.3, Triad users would declare `authorization: t.string().optional()` on every protected endpoint's request headers so the handler could read it. That was a lie — the header was required in practice — and it polluted the OpenAPI output. The `beforeHandler` runs **before** request schema validation and reads `ctx.rawHeaders['authorization']` directly. If the header is missing, the beforeHandler short-circuits with a typed 401; the main handler is never called. The `request.headers` section should only contain **business** headers — things like `x-request-id` or `x-idempotency-key` that your API documents as contract. Auth is cross-cutting and lives in the beforeHandler.

## 3. User and token repositories

Create `src/repositories/user.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';

import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User as UserSchema } from '../schemas/user.js';
import { hashPassword } from '../auth.js';

type User = Infer<typeof UserSchema>;

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

type UserRow = typeof users.$inferSelect;

export class UserRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
    };
  }

  async create(input: CreateUserInput): Promise<User> {
    const row: typeof users.$inferInsert = {
      id: crypto.randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
    };
    this.db.insert(users).values(row).run();
    return this.rowToApi(row as UserRow);
  }

  async findById(id: string): Promise<User | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? this.rowToApi(row) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const row = this.db.select().from(users).where(eq(users.email, email)).get();
    return row !== undefined;
  }

  async findByEmailWithHash(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    const row = this.db.select().from(users).where(eq(users.email, email)).get();
    if (!row) return null;
    return { ...this.rowToApi(row), passwordHash: row.passwordHash };
  }
}
```

Create `src/repositories/token.ts`:

```ts
export class TokenStore {
  private readonly tokens = new Map<string, string>();

  issue(userId: string): string {
    const token = crypto.randomUUID();
    this.tokens.set(token, userId);
    return token;
  }

  lookup(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  async clear(): Promise<void> {
    this.tokens.clear();
  }
}
```

Tokens live in memory intentionally: they are short-lived credentials, demo-grade UUIDs, and losing them on restart is a feature in a tutorial. A production app would use signed JWTs, Redis with TTLs, or an OIDC provider. Note that the service container is heterogeneous — the `TokenStore` is a plain `Map`, the `UserRepository` is Drizzle-backed, and handlers treat them the same way.

Update `src/services.ts`:

```ts
import { createDatabase, type Db } from './db/client.js';
import { BookRepository } from './repositories/book.js';
import { UserRepository } from './repositories/user.js';
import { TokenStore } from './repositories/token.js';

export interface BookshelfServices {
  db: Db;
  bookRepo: BookRepository;
  userRepo: UserRepository;
  tokens: TokenStore;
}

declare module '@triad/core' {
  interface ServiceContainer extends BookshelfServices {}
}

export function createServices(
  options: { db?: Db } = {},
): BookshelfServices {
  const db = options.db ?? createDatabase();
  return {
    db,
    bookRepo: new BookRepository(db),
    userRepo: new UserRepository(db),
    tokens: new TokenStore(),
  };
}
```

And `src/test-setup.ts`:

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
      await services.tokens.clear();
    },
  };
}
```

`tokens.clear()` matters: the in-memory `Map` would otherwise leak between scenarios in the same process, defeating the per-scenario DB isolation.

## 4. Register, login, and `/me`

Create `src/endpoints/auth.ts`:

```ts
import { endpoint, scenario } from '@triad/core';
import {
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from '../schemas/user.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth, verifyPassword } from '../auth.js';

export const register = endpoint({
  name: 'register',
  method: 'POST',
  path: '/auth/register',
  summary: 'Register a new user account',
  tags: ['Accounts'],
  request: { body: RegisterInput },
  responses: {
    201: { schema: AuthResult, description: 'Registration succeeded' },
    409: { schema: ApiError, description: 'Email is already in use' },
  },
  handler: async (ctx) => {
    const exists = await ctx.services.userRepo.existsByEmail(ctx.body.email);
    if (exists) {
      return ctx.respond[409]({
        code: 'EMAIL_IN_USE',
        message: `An account with email "${ctx.body.email}" already exists.`,
      });
    }
    const user = await ctx.services.userRepo.create(ctx.body);
    const token = ctx.services.tokens.issue(user.id);
    return ctx.respond[201]({ user, token });
  },
  behaviors: [
    scenario('New users can register')
      .given('a valid registration payload')
      .body({ email: 'alice@example.com', password: 'correct-horse', name: 'Alice' })
      .when('I POST /auth/register')
      .then('response status is 201')
      .and('response body matches AuthResult')
      .and('response body has user.email "alice@example.com"'),

    scenario('Registering with an existing email returns 409')
      .given('a user with that email already exists')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'other-password', name: 'Other Alice' })
      .when('I POST /auth/register')
      .then('response status is 409')
      .and('response body has code "EMAIL_IN_USE"'),
  ],
});

export const login = endpoint({
  name: 'login',
  method: 'POST',
  path: '/auth/login',
  summary: 'Exchange credentials for a bearer token',
  tags: ['Accounts'],
  request: { body: LoginInput },
  responses: {
    200: { schema: AuthResult, description: 'Login succeeded' },
    401: { schema: ApiError, description: 'Bad credentials' },
  },
  handler: async (ctx) => {
    const found = await ctx.services.userRepo.findByEmailWithHash(ctx.body.email);
    if (!found || !verifyPassword(ctx.body.password, found.passwordHash)) {
      return ctx.respond[401]({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    const { passwordHash: _omit, ...user } = found;
    const token = ctx.services.tokens.issue(user.id);
    return ctx.respond[200]({ user, token });
  },
  behaviors: [
    scenario('Valid credentials produce a token')
      .given('a registered user')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'correct-horse' })
      .when('I POST /auth/login')
      .then('response status is 200')
      .and('response body matches AuthResult'),

    scenario('Wrong password returns 401')
      .given('a registered user')
      .setup(async (services) => {
        await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
      })
      .body({ email: 'alice@example.com', password: 'wrong-password' })
      .when('I POST /auth/login')
      .then('response status is 401')
      .and('response body has code "INVALID_CREDENTIALS"'),
  ],
});

export const getMe = endpoint({
  name: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'Return the authenticated user',
  tags: ['Accounts'],
  beforeHandler: requireAuth,
  responses: {
    200: { schema: User, description: 'The authenticated user' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    return ctx.respond[200](ctx.state.user);
  },
  behaviors: [
    scenario('A valid token resolves to the authenticated user')
      .given('a logged-in user')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'correct-horse',
          name: 'Alice',
        });
        const token = services.tokens.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .when('I GET /me')
      .then('response status is 200')
      .and('response body has email "alice@example.com"'),

    scenario('Missing Authorization header returns 401')
      .given('no credentials are provided')
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),

    scenario('An unknown token returns 401')
      .given('a bogus token')
      .headers({ authorization: 'Bearer not-a-real-token' })
      .when('I GET /me')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});
```

## 5. Give books an owner

Add `ownerId` to the `Book` model in `src/schemas/book.ts`:

```ts
export const Book = t.model('Book', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  ownerId: t
    .string()
    .format('uuid')
    .storage({ columnName: 'owner_id', indexed: true, references: 'users.id' })
    .doc('The user that added this book'),
  title: t.string().minLength(1).maxLength(200),
  author: t.string().minLength(1).maxLength(200),
  isbn: t.string().pattern(/^[0-9-]{10,17}$/).optional(),
  publishedYear: t.int32().min(1000).max(2100),
  createdAt: t.datetime().storage({ defaultNow: true, columnName: 'created_at' }),
});

// CreateBook stays as-is — the owner comes from ctx.state.user, not the body
export const CreateBook = Book.pick('title', 'author', 'isbn', 'publishedYear').named('CreateBook');
export const UpdateBook = Book.pick('title', 'author').partial().named('UpdateBook');
```

Regenerate the Drizzle schema (`npx triad db generate`) or add `owner_id TEXT NOT NULL REFERENCES users(id)` to your `books` CREATE TABLE. Then extend `BookRepository` so `create` takes an `ownerId`, `list` filters by owner, and the rest of the methods just pass the id through:

```ts
// src/repositories/book.ts — changes only
export interface CreateBookInput {
  ownerId: string;
  title: string;
  author: string;
  isbn?: string;
  publishedYear: number;
}

export interface ListBooksOptions {
  ownerId: string;
  limit: number;
  offset: number;
}

// inside the class:
async list(options: ListBooksOptions): Promise<Book[]> {
  const rows = this.db
    .select()
    .from(books)
    .where(eq(books.ownerId, options.ownerId))
    .orderBy(asc(books.createdAt))
    .limit(options.limit)
    .offset(options.offset)
    .all();
  return rows.map((r) => this.rowToApi(r));
}
```

Update `rowToApi` / `apiToRow` to include `ownerId`. The existing `findById`, `update`, `delete` methods keep the same signatures — ownership enforcement happens one layer up, in the handler.

## 6. Protect the book endpoints and enforce ownership

Update `src/endpoints/books.ts` so every endpoint uses `requireAuth` and `checkOwnership` from `@triad/core`:

```ts
import { checkOwnership, endpoint, scenario, t } from '@triad/core';
import { Book, CreateBook, UpdateBook } from '../schemas/book.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';

export const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Add a book to your shelf',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: { body: CreateBook },
  responses: {
    201: { schema: Book, description: 'Book created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const book = await ctx.services.bookRepo.create({
      ownerId: ctx.state.user.id,
      ...ctx.body,
    });
    return ctx.respond[201](book);
  },
  behaviors: [
    scenario('An authenticated user can add a book')
      .given('a logged-in user')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw',
          name: 'Alice',
        });
        const token = services.tokens.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .body({
        title: 'The Pragmatic Programmer',
        author: 'Andy Hunt',
        publishedYear: 1999,
      })
      .when('I POST /books')
      .then('response status is 201')
      .and('response body matches Book')
      .and('response body has title "The Pragmatic Programmer"'),

    scenario('Anonymous users cannot add books')
      .given('no credentials are provided')
      .body({ title: 'x', author: 'y', publishedYear: 2020 })
      .when('I POST /books')
      .then('response status is 401'),
  ],
});

export const getBook = endpoint({
  name: 'getBook',
  method: 'GET',
  path: '/books/:id',
  summary: 'Fetch a book you own',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    200: { schema: Book, description: 'Book found' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Book belongs to another user' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const result = checkOwnership(
      await ctx.services.bookRepo.findById(ctx.params.id),
      ctx.state.user.id,
      (b) => b.ownerId,
    );
    if (!result.ok) {
      return result.reason === 'not_found'
        ? ctx.respond[404]({ code: 'NOT_FOUND', message: `No book with id ${ctx.params.id}.` })
        : ctx.respond[403]({ code: 'FORBIDDEN', message: 'You do not own this book.' });
    }
    return ctx.respond[200](result.entity);
  },
  behaviors: [
    scenario("A user can read their own book")
      .given('alice owns a book')
      .setup(async (services) => {
        const alice = await services.userRepo.create({ email: 'a@a.com', password: 'pw', name: 'Alice' });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const token = services.tokens.issue(alice.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ id: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 200')
      .and('response body has title "Dune"'),

    scenario("Reading another user's book returns 403")
      .given("alice owns a book but bob is logged in")
      .setup(async (services) => {
        const alice = await services.userRepo.create({ email: 'a@a.com', password: 'pw', name: 'Alice' });
        const bob = await services.userRepo.create({ email: 'b@b.com', password: 'pw', name: 'Bob' });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const token = services.tokens.issue(bob.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ id: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),

    scenario('Reading a non-existent book returns 404')
      .given('alice is logged in and the id is unknown')
      .setup(async (services) => {
        const alice = await services.userRepo.create({ email: 'a@a.com', password: 'pw', name: 'Alice' });
        const token = services.tokens.issue(alice.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .fixtures({ bookId: '00000000-0000-0000-0000-000000000000' })
      .params({ id: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 404'),
  ],
});
```

Apply the same shape to `updateBook` and `deleteBook` — fetch, `checkOwnership`, branch on `reason`, then perform the mutation. `listBooks` becomes owner-scoped: pass `ctx.state.user.id` as the `ownerId` to `ctx.services.bookRepo.list(...)` and add a scenario that confirms only the logged-in user's books are returned.

> **Why the explicit 403 vs 404 split?** `checkOwnership` returns `{ ok: false, reason: 'not_found' | 'forbidden' }` and deliberately lets the handler decide how to render it. Three reasonable choices:
>
> 1. **Honest:** 404 for missing, 403 for forbidden (what the tutorial does).
> 2. **Anti-enumeration:** both collapse to 404, so the API never leaks "this id exists but isn't yours". Safer for public-facing APIs with guessable ids.
> 3. **Public-existence:** 403 for both, so id existence is public but ownership is private.
>
> There is no universally right answer and Triad refuses to pick for you. See [DDD patterns §7](../ddd-patterns.md) for the full discussion.

## 7. Register the new endpoints

Update `src/app.ts` to add an `Accounts` context and extend `Library` with the user-scoped models:

```ts
import { createRouter } from '@triad/core';
import { register, login, getMe } from './endpoints/auth.js';
import { createBook, listBooks, getBook, updateBook, deleteBook } from './endpoints/books.js';
import { Book, CreateBook, UpdateBook } from './schemas/book.js';
import { User, RegisterInput, LoginInput, AuthResult } from './schemas/user.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Bookshelf API',
  version: '0.5.0',
  description: 'A personal book-collection API',
});

router.context(
  'Accounts',
  {
    description: 'User registration and authentication.',
    models: [User, RegisterInput, LoginInput, AuthResult, ApiError],
  },
  (ctx) => {
    ctx.add(register, login, getMe);
  },
);

router.context(
  'Library',
  {
    description: 'The authenticated user\'s personal book collection.',
    models: [Book, CreateBook, UpdateBook, User, ApiError],
  },
  (ctx) => {
    ctx.add(createBook, listBooks, getBook, updateBook, deleteBook);
  },
);

export default router;
```

Note that `User` is listed in the `Library` context's `models[]` too, even though the `Accounts` context owns its canonical shape. The book endpoints reference `User` via `ctx.state.user` and the ownership check, so Triad's validator needs to see it inside the context where it's used. This is the "cross-context leakage" check `triad validate` exists to enforce.

## 8. Run and check

```bash
npx triad test
npx triad docs
npx triad validate
```

You should see roughly 15 scenarios passing: the original 6 CRUD scenarios (now owner-scoped), the register/login/me scenarios, and the ownership/auth negative cases. `triad docs` now emits 401/403/404 for the protected endpoints as declared in the responses config.

Try the full flow:

```bash
npm start

# register
curl -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse","name":"Alice"}'
# copy the token

# add a book
curl -X POST http://localhost:3000/books \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token>' \
  -d '{"title":"Dune","author":"Frank Herbert","publishedYear":1965}'

# list your books
curl http://localhost:3000/books -H 'authorization: Bearer <token>'
```

## Next up

[Step 6 — WebSockets](06-websockets.md). Bookshelf is now a real auth-protected CRUD API. Time to add real-time notifications: a `bookReviews` channel that broadcasts a new review to everyone subscribed to that book's review stream.
