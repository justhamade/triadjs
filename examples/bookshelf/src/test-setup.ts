/**
 * Test setup module consumed by `triad test`.
 *
 * The CLI imports the default export as a services factory and calls
 * it before every scenario (per-scenario isolation). The returned
 * object exposes a `cleanup` method which the CLI invokes after each
 * scenario because `test.teardown: 'cleanup'` is set in
 * `triad.config.ts`.
 *
 * Each scenario gets a **fresh in-memory SQLite database**. This is
 * the cleanest form of test isolation — no truncation, no transaction
 * rollbacks, no cross-test leakage. The DDL runs on database creation
 * (`createDatabase()` in `./db/client.ts`) so each new connection
 * starts with a complete, empty schema in a couple of milliseconds.
 *
 * We also clear the in-memory `TokenStore` in `cleanup`. Unlike the
 * SQLite database, the token map lives outside the per-scenario DB
 * boundary — closing the connection is not enough to evict tokens
 * issued during the previous scenario.
 */

import { createDatabase } from './db/client.js';
import { createServices, type BookshelfServices } from './services.js';

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
      await services.tokenStore.clear();
    },
  };
}
