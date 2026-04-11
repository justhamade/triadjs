/**
 * E2e test harness for the tasktracker example (Express adapter).
 *
 * Each call to `startE2eServer()` builds a fresh Express app with an
 * in-memory SQLite database, binds it to an ephemeral TCP port via
 * `server.listen(0)`, and returns a handle the tests use to make real
 * HTTP calls.
 *
 * Complementary to the in-process `triad test` runs — both suites
 * exercise the same endpoints but from different angles.
 */

import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/db/client.js';
import { createServices, type TaskTrackerServices } from '../src/services.js';

export interface E2eHarness {
  baseUrl: string;
  services: TaskTrackerServices;
  close(): Promise<void>;
}

export async function startE2eServer(): Promise<E2eHarness> {
  const services = createServices({ db: createDatabase(':memory:') });
  const { app } = createApp({ services });

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    services.db.$raw.close();
    throw new Error('tasktracker e2e: server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    services,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      services.db.$raw.close();
    },
  };
}

/**
 * Register a user directly via the services container and return
 * a bearer token for that user. Used by tests that want to skip the
 * `/auth/register` HTTP dance and just get to the endpoint under test.
 */
export async function seedUser(
  harness: E2eHarness,
  overrides: Partial<{ email: string; password: string; name: string }> = {},
): Promise<{ userId: string; token: string; email: string; name: string }> {
  const email = overrides.email ?? `${crypto.randomUUID()}@example.com`;
  const name = overrides.name ?? 'Seeded User';
  const password = overrides.password ?? 'correct-horse';
  const user = await harness.services.userRepo.create({ email, password, name });
  const token = harness.services.tokens.issue(user.id);
  return { userId: user.id, token, email, name };
}
