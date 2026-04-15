---
name: triad-services
description: Use when wiring dependency injection for TriadJS — declaring services, module-augmenting `ServiceContainer`, creating `createServices()` factories, and threading repositories/clients onto `ctx.services` with full type inference and no casts.
---

# Services + Dependency Injection

Triad has one DI primitive: **`ctx.services`** — a `ServiceContainer` object you define and then expose to every handler. The goal is that handlers access `ctx.services.petRepo.create(...)` with full types and no import in the endpoint file.

## 1. Define your services interface + factory

```ts
// src/services.ts
import { PetRepository } from './repositories/pet.js';
import { AdopterRepository } from './repositories/adoption.js';
import type { Db } from './db/client.js';

export interface PetstoreServices {
  db: Db;
  petRepo: PetRepository;
  adopterRepo: AdopterRepository;
}

export function createServices({ db }: { db: Db }): PetstoreServices {
  return {
    db,
    petRepo: new PetRepository(db),
    adopterRepo: new AdopterRepository(db),
  };
}
```

## 2. Module-augment `ServiceContainer`

This is the single place where your container type is declared globally. Put it in `src/services.ts` alongside the factory:

```ts
declare module '@triadjs/core' {
  interface ServiceContainer extends PetstoreServices {}
}
```

After this, `ctx.services.petRepo` is typed in every handler **with no import required in the endpoint file**. If you forget this, `ctx.services` is `{}` and every access is a compile error.

## 3. Wire the adapter

### Fastify

```ts
// src/server.ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

const app = Fastify({ logger: true });
const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
await app.register(triadPlugin, { router, services: createServices({ db }) });
await app.listen({ port: 3000 });
```

### Express

```ts
import express from 'express';
import { createTriadRouter } from '@triadjs/express';
import router from './app.js';
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

const app = express();
app.use(express.json());
app.use(createTriadRouter(router, { services: createServices({ db: createDatabase() }) }));
app.listen(3000);
```

## 4. Per-request services (tenancy, auth-scoped DBs)

Pass a factory instead of a value. Fastify and the other adapters accept a function of the request:

```ts
await app.register(triadPlugin, {
  router,
  services: (request) => ({
    petRepo: petRepoFor(request.user.tenantId),
  }),
});
```

Every request gets a freshly-scoped services container. Useful for multi-tenancy, request-scoped transactions, and auth-scoped DB clients.

## 5. Test setup parity

Tests also need services. Point `triad.config.ts → test.setup` at a module whose default export produces the same shape:

```ts
// src/test-setup.ts
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

export default function createTestServices() {
  const db = createDatabase(':memory:'); // fresh DB per scenario
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() {
      services.db.$raw.close();
    },
  };
}
```

```ts
// triad.config.ts
export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
});
```

Every scenario calls the factory, so every scenario gets a clean DB. The `cleanup` method runs in `finally` even when scenarios fail.

## 6. Repository pattern

Handlers stay thin. Put DB code in `src/repositories/`:

```ts
// src/repositories/pet.ts
import { petsTable } from '../db/schema.generated.js';
import { eq } from 'drizzle-orm';
import { isUniqueViolation } from '@triadjs/drizzle';
import type { Db } from '../db/client.js';

export class PetRepository {
  constructor(private readonly db: Db) {}

  async create(input: { name: string; species: string; age: number }) {
    try {
      return await this.db.insert(petsTable).values({ id: crypto.randomUUID(), ...input }).returning().get();
    } catch (err) {
      const conflict = isUniqueViolation(err);
      if (conflict) throw new DuplicateNameError(input.name, conflict);
      throw err;
    }
  }

  async findById(id: string) {
    return this.db.select().from(petsTable).where(eq(petsTable.id, id)).get();
  }
}
```

Handlers then call `ctx.services.petRepo.create(ctx.body)` and map the result to `ctx.respond[...]`. No imports of database libraries in endpoint files. No casts. No `any`.

## Checklist when adding a new service

1. Add the field + type to the services interface in `src/services.ts`.
2. The `declare module '@triadjs/core'` augmentation already extends that interface, so no extra work.
3. Add the new service to `createServices(...)` — if it needs external dependencies (DB, env), the factory accepts them as parameters.
4. The test-setup factory should also instantiate it, typically using in-memory fakes or the same implementation against an `:memory:` DB.
5. Endpoint handlers access it via `ctx.services.yourService` — no import in the endpoint file.
