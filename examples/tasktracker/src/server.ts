/**
 * Express server entry point.
 *
 * This is the one place where the tasktracker diverges meaningfully
 * from petstore: we mount the Triad router using `@triad/express`'s
 * `createTriadRouter` instead of Fastify's `triadPlugin`. The router,
 * endpoints, schemas, repositories, and services are all identical in
 * shape to what a Fastify-based Triad app would look like — that's
 * the payoff of keeping the adapter at the edge.
 *
 * Two Express-specific things to note:
 *
 *   1. `app.use(express.json())` MUST be registered before the Triad
 *      router. Fastify parses JSON internally; Express does not.
 *   2. We default `PORT` to 3100 (petstore uses 3000) so both example
 *      servers can run in parallel during development.
 *
 * Database: reads `DATABASE_URL` from the environment. Defaults to
 * `:memory:` so `npm start` works with zero config. Set
 * `DATABASE_URL=./tasktracker.db` to persist across restarts.
 */

import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triad/express';

import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const app = express();

// JSON body parser — required before the Triad router. See module doc.
app.use(express.json());

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

app.use(createTriadRouter(router, { services }));

// Optional: format any stray Triad errors thrown from user middleware
// (not from endpoint handlers — those are caught inside the adapter).
app.use(triadErrorHandler());

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? '0.0.0.0';

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[tasktracker] listening on http://${host}:${port} ` +
      `(database: ${process.env.DATABASE_URL ?? ':memory:'})`,
  );
});

// Graceful shutdown — stop accepting new connections, then close the DB.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`[tasktracker] received ${signal}, shutting down`);
    server.close(() => {
      db.$raw.close();
      process.exit(0);
    });
  });
}
