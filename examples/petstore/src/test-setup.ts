/**
 * Test setup module consumed by `triad test`.
 *
 * The CLI imports the default export as a services factory and calls it
 * before every scenario (per-scenario isolation). The returned object
 * exposes a `cleanup` method which the CLI calls after each scenario
 * because `test.teardown: 'cleanup'` is set in `triad.config.ts`.
 *
 * Each scenario gets a **fresh in-memory SQLite database**. This is the
 * cleanest form of test isolation — no truncation, no transaction
 * rollbacks, no cross-test leakage. The DDL runs on database creation
 * (`createDatabase()` in `./db/client.ts`) so each new connection starts
 * with a complete, empty schema in a couple of milliseconds.
 *
 * Switching to Drizzle + SQLite here (instead of in-memory Maps) means
 * the tests exercise real SQL: enum constraints, foreign keys, NOT NULL,
 * JSON serialization, ORDER BY. Bugs like "I forgot to handle NULL in
 * the WHERE clause" surface here the same way they would in production.
 */

import { createServices, type PetstoreServices } from './services.js';
import { createDatabase } from './db/client.js';

interface TestServices extends PetstoreServices {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const db = createDatabase(':memory:');
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() {
      // Close the connection so better-sqlite3 releases the memory.
      // Triad's test runner calls this after every scenario.
      services.db.$raw.close();
      // The in-memory chat store is a simple Array, so clearing it is
      // enough — no socket or transaction to unwind.
      await services.messageStore.clear();
    },
  };
}
