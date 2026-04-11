/**
 * E2e test harness for the petstore example.
 *
 * Each call to `startE2eServer()` builds a fresh Fastify app with an
 * in-memory SQLite database, binds it to an ephemeral TCP port
 * (`listen({ port: 0 })`), and returns a handle the tests can use to
 * make real HTTP and WebSocket calls.
 *
 * This runs the SAME code path as `npm start` — the only difference
 * is that the port is allocated by the kernel rather than hard-coded,
 * and the in-memory DB is thrown away after the test. That makes the
 * suite complementary to (not a replacement for) the in-process
 * `triad test` harness, which exercises handlers against a synthetic
 * `HandlerContext`.
 */

import { createApp } from '../src/server.js';
import { createDatabase } from '../src/db/client.js';
import { createServices, type PetstoreServices } from '../src/services.js';

export interface E2eHarness {
  baseUrl: string;
  wsBaseUrl: string;
  services: PetstoreServices;
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
    throw new Error('petstore e2e: Fastify did not bind to a TCP port');
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
