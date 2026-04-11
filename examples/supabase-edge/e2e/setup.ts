/**
 * E2e test harness for the supabase-edge example.
 *
 * Runs the Hono app under the Node runtime via `@hono/node-server`'s
 * `serve()` helper with `port: 0`, so each test gets an ephemeral port
 * and a fresh memory-mode service container. No Supabase project is
 * contacted — the `MemoryAuthVerifier` stands in for real JWT
 * validation, mirroring the pattern the existing `triad test` harness
 * uses.
 */

import { type AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createApp } from '../src/server.js';
import {
  createServices,
  type SupabaseEdgeServices,
} from '../src/services.js';
import { MemoryAuthVerifier } from '../src/auth-verifier.js';

export interface E2eHarness {
  baseUrl: string;
  services: SupabaseEdgeServices;
  authVerifier: MemoryAuthVerifier;
  close(): Promise<void>;
}

export async function startE2eServer(): Promise<E2eHarness> {
  const authVerifier = new MemoryAuthVerifier();
  const services = createServices({ mode: 'memory', authVerifier });
  const { app } = createApp({ services });

  const server: ServerType = await new Promise((resolve, reject) => {
    try {
      const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s));
      s.once('error', reject);
    } catch (err) {
      reject(err);
    }
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('supabase-edge e2e: server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    services,
    authVerifier,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/**
 * Seed a user through the memory auth verifier and return a synthetic
 * bearer token tests can use in the `Authorization` header.
 */
export function seedUser(
  harness: E2eHarness,
  user: { id: string; email: string; name: string },
): string {
  return harness.authVerifier.register(user);
}

export const ALICE = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  name: 'Alice',
} as const;

export const BOB = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
  name: 'Bob',
} as const;
