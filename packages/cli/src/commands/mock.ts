/**
 * `triad mock` — a zero-dependency mock HTTP server driven by the
 * project's Triad router.
 *
 * The server walks every HTTP endpoint in the router, compiles each
 * path pattern into a regex, and dispatches incoming requests to the
 * first matching pattern. Instead of invoking the real handler, it
 * synthesises a happy-path response body from the endpoint's response
 * schema via `fakeFromSchema`, so the shape is guaranteed to match
 * the contract clients are coded against.
 *
 * Flags:
 *   - `--latency <ms>`    — sleep this many ms before every response
 *   - `--error-rate <r>`  — return 500 on `r` fraction of requests
 *   - `--seed <n>`        — seed the fake-data RNG for reproducibility
 *   - `--port <n>`        — bind port (default 3333; 0 → OS chooses)
 *
 * This command is intentionally built on `node:http` so the CLI stays
 * framework-free.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import pc from 'picocolors';
import type { Endpoint, Router, SchemaNode } from '@triad/core';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';
import { fakeFromSchema } from '../schema-fake.js';

export interface MockOptions {
  config?: string;
  router?: string;
  port?: number;
  latency?: number;
  errorRate?: number;
  seed?: number;
}

export interface StartMockServerOptions {
  router: Router;
  port?: number;
  latency?: number;
  errorRate?: number;
  seed?: number;
  quiet?: boolean;
}

export interface MockServerHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

interface CompiledRoute {
  readonly endpoint: Endpoint;
  readonly regex: RegExp;
  readonly keys: readonly string[];
  readonly happyStatus: number;
  readonly happySchema: SchemaNode | undefined;
}

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

function compileRoute(endpoint: Endpoint): CompiledRoute {
  const keys: string[] = [];
  const escaped = endpoint.path
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(PARAM, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
  const regex = new RegExp(`^${escaped}$`);
  const { happyStatus, happySchema } = pickHappyResponse(endpoint);
  return { endpoint, regex, keys, happyStatus, happySchema };
}

function pickHappyResponse(endpoint: Endpoint): {
  happyStatus: number;
  happySchema: SchemaNode | undefined;
} {
  const statuses = Object.keys(endpoint.responses).map((s) => Number(s));
  const successful = statuses.filter((s) => s >= 200 && s < 300).sort();
  // Prefer 200, then 201, then first 2xx, then first declared.
  const preferred =
    (successful.includes(200) && 200) ||
    (successful.includes(201) && 201) ||
    successful[0] ||
    statuses[0] ||
    200;
  const cfg = endpoint.responses[preferred as number];
  return { happyStatus: preferred, happySchema: cfg?.schema };
}

export async function startMockServer(
  options: StartMockServerOptions,
): Promise<MockServerHandle> {
  const routes = options.router.allEndpoints().map(compileRoute);
  const latency = options.latency ?? 0;
  const errorRate = clampRate(options.errorRate ?? 0);
  const seed = options.seed;
  const quiet = options.quiet === true;

  const server = http.createServer((req, res) => {
    const started = Date.now();
    void handleRequest(req, res, routes, { latency, errorRate, seed, quiet, started });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3333, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

interface RequestContext {
  latency: number;
  errorRate: number;
  seed: number | undefined;
  quiet: boolean;
  started: number;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  routes: readonly CompiledRoute[],
  ctx: RequestContext,
): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const method = (req.method ?? 'GET').toUpperCase();

  if (ctx.latency > 0) {
    await delay(ctx.latency);
  }

  if (ctx.errorRate > 0 && Math.random() < ctx.errorRate) {
    sendJson(res, 500, {
      code: 'MOCK_ERROR',
      message: 'Simulated failure (triad mock --error-rate)',
    });
    logRequest(ctx, method, pathname, 500);
    return;
  }

  const match = findRoute(routes, method, pathname);
  if (!match) {
    sendJson(res, 404, {
      code: 'NOT_FOUND',
      message: `No mock handler for ${method} ${pathname}`,
    });
    logRequest(ctx, method, pathname, 404);
    return;
  }

  const { route } = match;
  if (!route.happySchema) {
    sendJson(res, route.happyStatus, null);
    logRequest(ctx, method, pathname, route.happyStatus);
    return;
  }

  const body = generateBody(route.happySchema, ctx.seed);
  sendJson(res, route.happyStatus, body);
  logRequest(ctx, method, pathname, route.happyStatus);
}

function findRoute(
  routes: readonly CompiledRoute[],
  method: string,
  pathname: string,
): { route: CompiledRoute } | undefined {
  for (const route of routes) {
    if (route.endpoint.method !== method) continue;
    if (route.regex.test(pathname)) return { route };
  }
  return undefined;
}

function generateBody(schema: SchemaNode, seed: number | undefined): unknown {
  const opts: { seed?: number } = {};
  if (seed !== undefined) opts.seed = seed;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = fakeFromSchema(schema, opts);
    const result = schema.validate(candidate);
    if (result.success) return candidate;
    if (seed !== undefined) opts.seed = seed + attempt + 1;
  }
  throw new CliError(
    `Failed to generate schema-valid mock data for ${schema.kind}.`,
    'MOCK_FAILED',
  );
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

function logRequest(
  ctx: RequestContext,
  method: string,
  pathname: string,
  status: number,
): void {
  if (ctx.quiet) return;
  const elapsed = Date.now() - ctx.started;
  process.stdout.write(
    `${pc.dim('[mock]')} ${method} ${pathname} → ${statusColor(status)(
      String(status),
    )} ${pc.dim(`(${elapsed}ms)`)}\n`,
  );
}

function statusColor(status: number): (s: string) => string {
  if (status >= 500) return pc.red;
  if (status >= 400) return pc.yellow;
  return pc.green;
}

function clampRate(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** CLI entry point — wires the mock server to the loaded project config. */
export async function runMock(opts: MockOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const startOpts: StartMockServerOptions = {
    router,
    port: opts.port ?? 3333,
  };
  if (opts.latency !== undefined) startOpts.latency = opts.latency;
  if (opts.errorRate !== undefined) startOpts.errorRate = opts.errorRate;
  if (opts.seed !== undefined) startOpts.seed = opts.seed;

  const handle = await startMockServer(startOpts);

  process.stdout.write(
    `${pc.green('✓')} Mock server listening on ${pc.bold(handle.url)}\n` +
      `  ${pc.dim(
        `${router.allEndpoints().length} endpoint(s) · latency=${startOpts.latency ?? 0}ms · error-rate=${startOpts.errorRate ?? 0}`,
      )}\n` +
      `  ${pc.dim('Press Ctrl+C to stop.')}\n`,
  );

  const shutdown = (): void => {
    process.stdout.write(`\n${pc.dim('[mock] shutting down...')}\n`);
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
