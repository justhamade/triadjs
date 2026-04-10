/**
 * Service container wiring — the single place where dependencies are
 * assembled. `createServices()` is called by both the production entry
 * point (`server.ts`) and the test setup module (`test-setup.ts`), so
 * there is exactly one definition of "what services exist" in this app.
 *
 * The function takes the Drizzle `Db` as a dependency so the caller
 * decides whether to use a file-backed database (prod), an in-memory
 * database (dev/tests), or even a shared connection pool. This is the
 * canonical dependency-injection pattern for testable repositories.
 *
 * The container mixes persistence strategies: pet/adopter/adoption are
 * Drizzle-backed (via the shared `db`), chat messages live in an
 * in-memory `MessageStore`. Handlers don't care which store they're
 * talking to — `ctx.services.petRepo` and `ctx.services.messageStore`
 * are the same kind of thing from the caller's perspective.
 *
 * Augmenting `ServiceContainer` via declaration merging gives every
 * handler static typing for `ctx.services.*` without manual imports.
 */

import { createDatabase, type Db } from './db/client.js';
import {
  AdopterRepository,
  AdoptionRepository,
} from './repositories/adoption.js';
import { MessageStore } from './repositories/message.js';
import { PetRepository } from './repositories/pet.js';

export interface PetstoreServices {
  db: Db;
  petRepo: PetRepository;
  adopterRepo: AdopterRepository;
  adoptionRepo: AdoptionRepository;
  messageStore: MessageStore;
}

declare module '@triad/core' {
  interface ServiceContainer extends PetstoreServices {}
}

export interface CreateServicesOptions {
  /** Provide an existing Drizzle client. If omitted, a fresh in-memory DB is created. */
  db?: Db;
}

export function createServices(
  options: CreateServicesOptions = {},
): PetstoreServices {
  const db = options.db ?? createDatabase();
  return {
    db,
    petRepo: new PetRepository(db),
    adopterRepo: new AdopterRepository(db),
    adoptionRepo: new AdoptionRepository(db),
    messageStore: new MessageStore(),
  };
}
