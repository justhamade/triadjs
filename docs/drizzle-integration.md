# Drizzle ORM Integration

Triad is ORM-agnostic — the handler delegates to `ctx.services`, which can use any data layer. But **Drizzle ORM** is the recommended and documented choice because both share the same philosophy.

---

## Why Drizzle (not Prisma)

- **Same philosophy.** Triad is code-first TypeScript. Drizzle is code-first TypeScript. Prisma uses its own `.prisma` schema language — a second source of truth, which violates Triad's core principle.
- **No generation step.** Drizzle types update as you save. Prisma requires `prisma generate` after every schema change — exactly the drift opportunity Triad exists to eliminate.
- **Clean boundary.** Triad's `t.model()` defines the API contract. Drizzle's `pgTable()` defines the storage contract. Both are TypeScript; the mapping between them is explicit and auditable.
- **Repository-friendly.** Drizzle is a thin query builder, not an opinionated ORM. It fits naturally inside the repository pattern.
- **Lightweight.** ~7.4 KB, zero dependencies, serverless-ready.

Prisma, TypeORM, Kysely, or raw SQL all work with Triad. Drizzle is recommended; not required.

---

## Two Schemas, One Language, Clear Boundary

Triad and Drizzle schemas are **different things that serve different purposes**, even when they describe similar shapes.

```typescript
// ============================================
// TRIAD SCHEMA — The API contract
// "What crosses the wire"
// ============================================
import { t } from '@triadjs/core';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name').example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years').example(3),
  status: t.enum('available', 'adopted', 'pending').doc('Adoption status').default('available'),
  tags: t.array(t.string()).optional().doc('Searchable tags'),
  createdAt: t.datetime().doc('Record creation timestamp'),
});

const CreatePet = Pet.pick('name', 'species', 'age', 'tags').named('CreatePet');
```

```typescript
// ============================================
// DRIZZLE SCHEMA — The storage contract
// "What goes in the database"
// ============================================
import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const speciesEnum = pgEnum('species', ['dog', 'cat', 'bird', 'fish']);
export const statusEnum = pgEnum('status', ['available', 'adopted', 'pending']);

export const pets = pgTable('pets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  species: speciesEnum('species').notNull(),
  age: integer('age').notNull(),
  status: statusEnum('status').notNull().default('available'),
  tags: text('tags').array(),
  createdAt: timestamp('created_at').notNull().defaultNow(),

  // Database-only columns — NOT in the API contract
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),                   // Soft delete
  internalNotes: text('internal_notes'),                // Staff-only
  intakeSource: varchar('intake_source', { length: 50 }),
});
```

- The Triad schema has things the DB doesn't: API-specific formatting, validation constraints, examples, documentation.
- The Drizzle schema has columns the API doesn't expose: `updatedAt`, `deletedAt`, `internalNotes`, `intakeSource`.
- This is intentional and correct. The API boundary and the storage boundary are different concerns.
- **The mapping lives in the repository.**

---

## The Repository Pattern — Bridging Triad and Drizzle

```typescript
import { eq, and, ilike, sql } from 'drizzle-orm';
import { db } from './database';
import { pets } from './schema';
import type { t } from '@triadjs/core';
import type { Pet as PetSchema, CreatePet as CreatePetSchema } from '../schemas/pet';

type PetRow = typeof pets.$inferSelect;
type NewPetRow = typeof pets.$inferInsert;

type Pet = t.infer<typeof PetSchema>;
type CreatePetInput = t.infer<typeof CreatePetSchema>;

export class PetRepository {
  constructor(private readonly db: typeof db) {}

  /** Map database row → API response. */
  private toApiModel(row: PetRow): Pet {
    return {
      id: row.id,
      name: row.name,
      species: row.species,
      age: row.age,
      status: row.status,
      tags: row.tags ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
    // updatedAt, deletedAt, internalNotes are intentionally omitted.
  }

  /** Map API input → database insert. */
  private toDbRow(input: CreatePetInput): NewPetRow {
    return {
      name: input.name,
      species: input.species,
      age: input.age,
      tags: input.tags ?? null,
      // id, status, createdAt, updatedAt come from DB defaults.
    };
  }

  async create(input: CreatePetInput): Promise<Pet> {
    const [row] = await this.db.insert(pets).values(this.toDbRow(input)).returning();
    return this.toApiModel(row);
  }

  async findById(id: string): Promise<Pet | null> {
    const [row] = await this.db
      .select()
      .from(pets)
      .where(and(eq(pets.id, id), sql`${pets.deletedAt} IS NULL`));
    return row ? this.toApiModel(row) : null;
  }

  async findByNameAndSpecies(name: string, species: string): Promise<Pet | null> {
    const [row] = await this.db
      .select()
      .from(pets)
      .where(
        and(
          ilike(pets.name, name),
          eq(pets.species, species as typeof pets.species.enumValues[number]),
          sql`${pets.deletedAt} IS NULL`,
        ),
      );
    return row ? this.toApiModel(row) : null;
  }

  async list(filters: {
    species?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<Pet[]> {
    const conditions = [sql`${pets.deletedAt} IS NULL`];
    if (filters.species) conditions.push(eq(pets.species, filters.species as any));
    if (filters.status) conditions.push(eq(pets.status, filters.status as any));

    const rows = await this.db
      .select()
      .from(pets)
      .where(and(...conditions))
      .limit(filters.limit)
      .offset(filters.offset);

    return rows.map((row) => this.toApiModel(row));
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.db
      .update(pets)
      .set({ deletedAt: new Date() })
      .where(eq(pets.id, id));
    return (result.rowCount ?? 0) > 0;
  }
}
```

---

## Wiring It Up

```typescript
// services.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PetRepository } from './repositories/pet';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export const services = {
  petRepo: new PetRepository(db),
  // ... other repositories and services
};
```

```typescript
// app.ts
import { createRouter } from '@triadjs/core';
import { createPet, getPet, listPets } from './endpoints/pets';
import { services } from './services';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  services,
});

router.add(createPet, getPet, listPets);
export default router;
```

```typescript
// endpoints/pets.ts
export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Pet created' },
    400: { schema: ApiError, description: 'Validation error' },
    409: { schema: ApiError, description: 'Duplicate pet' },
  },
  handler: async (ctx) => {
    const existing = await ctx.services.petRepo.findByNameAndSpecies(
      ctx.body.name,
      ctx.body.species,
    );
    if (existing) {
      return ctx.respond[409]({
        code: 'DUPLICATE',
        message: `A ${ctx.body.species} named "${ctx.body.name}" already exists`,
      });
    }
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet'),

    scenario('Pet names must be unique within the same species')
      .given('a dog named "Buddy" already exists')
      .setup(async (services) => {
        await services.petRepo.create({ name: 'Buddy', species: 'dog', age: 3 });
      })
      .body({ name: 'Buddy', species: 'dog', age: 5 })
      .when('I create a pet')
      .then('response status is 409')
      .and('response body has code "DUPLICATE"'),
  ],
});
```

---

## Migrations (Drizzle Kit)

```bash
npx drizzle-kit generate       # Generate migration from schema changes
npx drizzle-kit migrate        # Apply migrations
npx drizzle-kit studio         # Browse data in the browser
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Drizzle migrations are generated from the TypeScript storage schema, not from Triad's API schema. The database schema evolves independently of the API schema — they may change at different times. The repository mapping layer absorbs the difference.

---

## Testing with Drizzle

```typescript
// test-setup.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pets } from './db/schema';
import { PetRepository } from './repositories/pet';

export async function createTestServices() {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle/migrations' });

  return {
    petRepo: new PetRepository(db),
    async cleanup() {
      await db.delete(pets);
    },
    async disconnect() {
      await pool.end();
    },
  };
}
```

```typescript
// triad.config.ts
import { defineConfig } from '@triadjs/cli';

export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
});
```

---

## Value Objects in Drizzle

Triad value objects (`Money`, `EmailAddress`) map to composite Drizzle columns. Money, for example, is stored as cents + currency to avoid float precision errors.

```typescript
const Money = t.value('Money', {
  amount: t.float64().min(0),
  currency: t.enum('USD', 'CAD', 'EUR'),
});

// Drizzle — two columns
export const adoptions = pgTable('adoptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  petId: uuid('pet_id').notNull().references(() => pets.id),
  adopterId: uuid('adopter_id').notNull(),
  feeAmount: integer('fee_amount').notNull(),         // Cents
  feeCurrency: varchar('fee_currency', { length: 3 }).notNull().default('USD'),
  completedAt: timestamp('completed_at').notNull().defaultNow(),
});

// Repository maps between them
private toApiMoney(cents: number, currency: string) {
  return { amount: cents / 100, currency };
}

private toDbMoney(money: { amount: number; currency: string }) {
  return {
    feeAmount: Math.round(money.amount * 100),
    feeCurrency: money.currency,
  };
}
```

---

## Relations and Joins

```typescript
import { relations } from 'drizzle-orm';

export const petsRelations = relations(pets, ({ many }) => ({
  adoptions: many(adoptions),
}));

export const adoptionsRelations = relations(adoptions, ({ one }) => ({
  pet: one(pets, { fields: [adoptions.petId], references: [pets.id] }),
}));

// Repository uses relational query
async findWithAdoptions(petId: string) {
  const result = await this.db.query.pets.findFirst({
    where: eq(pets.id, petId),
    with: { adoptions: true },
  });
  return result ? this.toApiModelWithAdoptions(result) : null;
}
```

---

## Transactions

```typescript
async adoptPet(petId: string, adopterId: string, fee: { amount: number; currency: string }) {
  return await this.db.transaction(async (tx) => {
    const [updatedPet] = await tx
      .update(pets)
      .set({ status: 'adopted' })
      .where(and(eq(pets.id, petId), eq(pets.status, 'available')))
      .returning();

    if (!updatedPet) {
      throw new DomainError('PET_NOT_AVAILABLE', 'Pet is not available for adoption');
    }

    const [adoption] = await tx
      .insert(adoptions)
      .values({ petId, adopterId, ...this.toDbMoney(fee) })
      .returning();

    return this.toApiAdoption(adoption, updatedPet);
  });
}
```

---

## Recommended Project Structure

```
src/
├── db/
│   ├── schema.ts           # Drizzle tables (storage contract)
│   ├── relations.ts        # Drizzle relations
│   ├── database.ts         # Connection setup
│   └── seed.ts             # Dev/test seed data
├── repositories/
│   ├── pet.ts              # PetRepository — bridges Triad ↔ Drizzle
│   ├── adoption.ts
│   └── types.ts
├── schemas/
│   ├── pet.ts              # Triad t.model() definitions (API contract)
│   ├── adoption.ts
│   └── common.ts           # ApiError, Money, shared value objects
├── endpoints/
│   ├── pets.ts             # Triad endpoints + handlers + behaviors
│   └── adoptions.ts
├── services.ts             # Service container wiring
├── app.ts                  # Triad router
└── test-setup.ts           # Test database
drizzle/
├── migrations/             # Generated SQL
└── meta/
drizzle.config.ts
triad.config.ts
```

The repository is the translation layer. It is the only place that knows about both worlds.
