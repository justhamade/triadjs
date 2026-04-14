/**
 * Express server entry point.
 *
 * This is the one place where the tasktracker diverges meaningfully
 * from petstore: we mount the Triad router using `@triadjs/express`'s
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
 *
 * ## createApp factory
 *
 * `createApp()` returns a ready-to-listen Express app plus the service
 * container, without binding to a port. The e2e test harness uses it
 * to spin up an isolated server on an ephemeral port per test.
 * `npm start` still binds to the configured port through the
 * module-entry guard at the bottom.
 */

import { pathToFileURL } from 'node:url';
import express, { type Express } from 'express';
import { createTriadRouter, triadErrorHandler } from '@triadjs/express';

import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices, type TaskTrackerServices } from './services.js';

export interface CreateAppOptions {
  /** Provide pre-built services (e.g. with an in-memory test DB). */
  services?: TaskTrackerServices;
}

export interface CreatedApp {
  app: Express;
  services: TaskTrackerServices;
}

export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const app = express();

  // JSON body parser — required before the Triad router.
  app.use(express.json());

  const services =
    options.services ??
    createServices({ db: createDatabase(process.env['DATABASE_URL'] ?? ':memory:') });

  app.use(createTriadRouter(router, { services }));

  // Optional: format any stray Triad errors thrown from user middleware
  // (not from endpoint handlers — those are caught inside the adapter).
  app.use(triadErrorHandler());

  return { app, services };
}

const isMainEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const { app, services } = createApp();
  const port = Number(process.env['PORT'] ?? 3100);
  const host = process.env['HOST'] ?? '0.0.0.0';

  const server = app.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[tasktracker] listening on http://${host}:${port} ` +
        `(database: ${process.env['DATABASE_URL'] ?? ':memory:'})`,
    );
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // eslint-disable-next-line no-console
      console.log(`[tasktracker] received ${signal}, shutting down`);
      server.close(() => {
        services.db.$raw.close();
        process.exit(0);
      });
    });
  }
}
