/**
 * Fastify server entry point.
 *
 * Run with `npm start` (uses `tsx`). The handler logic, validation, and
 * error mapping are all provided by `@triad/fastify`'s `triadPlugin` —
 * this file only does process-level concerns: logging, port, database
 * lifecycle, and graceful shutdown.
 *
 * Database: reads `DATABASE_URL` from the environment. Defaults to
 * `:memory:` so `npm start` works with zero config. Set
 * `DATABASE_URL=./petstore.db` to persist across restarts.
 */

import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

await app.register(triadPlugin, { router, services });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(
    { port, host, database: process.env.DATABASE_URL ?? ':memory:' },
    'Petstore API ready',
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown on Ctrl+C / SIGTERM — close Fastify first, then the DB.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    db.$raw.close();
    process.exit(0);
  });
}
