/**
 * Fastify server entry point.
 *
 * Run with `npm start` (uses `tsx`). The handler logic, validation, and
 * error mapping are all provided by `@triadjs/fastify`'s `triadPlugin` —
 * this file only does process-level concerns: logging, port, database
 * lifecycle, and graceful shutdown.
 *
 * Database: reads `DATABASE_URL` from the environment. Defaults to
 * `:memory:` so `npm start` works with zero config. Set
 * `DATABASE_URL=./petstore.db` to persist across restarts.
 *
 * ## createApp factory
 *
 * `createApp()` builds a ready-to-listen Fastify instance and its
 * service container without binding to a port. The e2e test harness
 * calls this directly and then runs `listen({ port: 0 })` itself so
 * every test gets an ephemeral port. `npm start` still binds to the
 * configured port via the module-entry guard at the bottom of the
 * file.
 */

import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices, type PetstoreServices } from './services.js';

export interface CreateAppOptions {
  /** Provide pre-built services (e.g. with an in-memory test DB). */
  services?: PetstoreServices;
  /** Override Fastify logger config. Defaults to `false` for tests. */
  logger?: FastifyServerOptions['logger'];
}

export interface CreatedApp {
  fastify: FastifyInstance;
  services: PetstoreServices;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<CreatedApp> {
  const fastify = Fastify({
    logger: options.logger ?? false,
  });

  const services =
    options.services ??
    createServices({ db: createDatabase(process.env['DATABASE_URL'] ?? ':memory:') });

  // `docs: true` serves Swagger UI at /api-docs and the live OpenAPI
  // spec at /api-docs/openapi.json. Explicit `true` so it works in
  // production too; the default is "on in dev, off in production".
  await fastify.register(triadPlugin, { router, services, docs: true });

  return { fastify, services };
}

// Only run the production listen path when this file is invoked
// directly (`tsx src/server.ts`). During tests the e2e harness calls
// `createApp()` and manages its own lifecycle.
const isMainEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const { fastify, services } = await createApp({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    fastify.log.info(
      { port, host, database: process.env['DATABASE_URL'] ?? ':memory:' },
      'Petstore API ready',
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      fastify.log.info({ signal }, 'Shutting down');
      await fastify.close();
      services.db.$raw.close();
      process.exit(0);
    });
  }
}
