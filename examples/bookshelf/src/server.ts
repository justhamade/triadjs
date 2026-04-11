/**
 * Fastify server entry point.
 *
 * Run with `npm start` (tsx). Handler logic, validation, and error
 * mapping are all provided by `@triad/fastify`'s `triadPlugin` — this
 * file only does process-level concerns: logging, port, database
 * lifecycle, and graceful shutdown.
 *
 * Defaults to port 3200 so all three reference examples can run in
 * parallel during development (petstore on 3000, tasktracker on 3100,
 * bookshelf here on 3200).
 *
 * ## createApp factory
 *
 * `createApp()` builds a ready-to-listen Fastify instance and its
 * service container without binding to a port. The e2e test harness
 * calls this directly and runs its own `listen({ port: 0 })` so every
 * test gets an ephemeral port. `npm start` still binds to the
 * configured port via the module-entry guard at the bottom of the file.
 */

import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices, type BookshelfServices } from './services.js';

export interface CreateAppOptions {
  /** Provide pre-built services (e.g. with an in-memory test DB). */
  services?: BookshelfServices;
  /** Override Fastify logger config. Defaults to `false` for tests. */
  logger?: FastifyServerOptions['logger'];
}

export interface CreatedApp {
  fastify: FastifyInstance;
  services: BookshelfServices;
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

  await fastify.register(triadPlugin, { router, services });

  return { fastify, services };
}

const isMainEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const { fastify, services } = await createApp({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
  const port = Number(process.env['PORT'] ?? 3200);
  const host = process.env['HOST'] ?? '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    fastify.log.info(
      { port, host, database: process.env['DATABASE_URL'] ?? ':memory:' },
      'Bookshelf API ready',
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
