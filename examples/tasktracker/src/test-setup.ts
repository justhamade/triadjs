/**
 * Test setup module consumed by `triad test`.
 *
 * Same contract as petstore: the CLI imports the default export as a
 * services factory and calls it before every scenario. The returned
 * object exposes `cleanup` which the CLI invokes after each scenario
 * (configured via `test.teardown: 'cleanup'` in `triad.config.ts`).
 *
 * ## Why token cleanup matters
 *
 * Unlike petstore, this example carries authentication state between
 * the `setup(services)` block and the `.headers(...)` call on every
 * scenario. That state lives in the in-memory `TokenStore` — a plain
 * `Map` — not in the SQLite database. Closing the database between
 * scenarios is enough for pet/project/task isolation, but tokens
 * would leak across tests unless we explicitly wipe them. Forget
 * this step and the "unknown token" scenario could pass on a stale
 * token from a previous test, defeating the point of the assertion.
 */

import { createDatabase } from './db/client.js';
import { createServices, type TaskTrackerServices } from './services.js';

interface TestServices extends TaskTrackerServices {
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
