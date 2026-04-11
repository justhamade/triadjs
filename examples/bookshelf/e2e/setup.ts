/**
 * E2e test harness for the bookshelf example.
 *
 * Each call to `startE2eServer()` builds a fresh Fastify app with an
 * in-memory SQLite database, binds it to an ephemeral TCP port, and
 * returns a handle for making real HTTP and WebSocket calls.
 */

import { createApp } from '../src/server.js';
import { createDatabase } from '../src/db/client.js';
import { createServices, type BookshelfServices } from '../src/services.js';

export interface E2eHarness {
  baseUrl: string;
  wsBaseUrl: string;
  services: BookshelfServices;
  close(): Promise<void>;
}

export async function startE2eServer(): Promise<E2eHarness> {
  const services = createServices({ db: createDatabase(':memory:') });
  const { fastify } = await createApp({ services });
  await fastify.listen({ port: 0, host: '127.0.0.1' });

  const address = fastify.server.address();
  if (!address || typeof address === 'string') {
    await fastify.close();
    services.db.$raw.close();
    throw new Error('bookshelf e2e: Fastify did not bind to a TCP port');
  }
  const { port } = address;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsBaseUrl: `ws://127.0.0.1:${port}`,
    services,
    async close() {
      await fastify.close();
      services.db.$raw.close();
    },
  };
}

/**
 * Seed a user directly through the services container and return a
 * token plus the user's primary identity fields. Avoids re-running the
 * full register HTTP flow on every test.
 */
export async function seedUser(
  harness: E2eHarness,
  overrides: Partial<{ email: string; password: string; name: string }> = {},
): Promise<{ userId: string; token: string; email: string; name: string }> {
  const email = overrides.email ?? `${crypto.randomUUID()}@example.com`;
  const name = overrides.name ?? 'Seeded User';
  const password = overrides.password ?? 'pw1234';
  const user = await harness.services.userRepo.create({ email, password, name });
  const token = harness.services.tokenStore.issue(user.id);
  return { userId: user.id, token, email, name };
}
