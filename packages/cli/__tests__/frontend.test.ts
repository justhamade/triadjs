/**
 * `triad frontend generate` CLI test.
 *
 * Runs against the fixture petstore project, writes to a tmp directory,
 * and asserts on the shape of the generated TanStack Query client.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runFrontendGenerate } from '../src/commands/frontend.js';
import { CliError } from '../src/errors.js';

const FIXTURE_DIR = fileURLToPath(
  new URL('./fixtures/petstore/', import.meta.url),
);
const CONFIG_PATH = path.join(FIXTURE_DIR, 'triad.config.ts');

// Bookshelf has both HTTP endpoints AND a WebSocket channel, so it's
// the fixture of choice for the channel-client target test.
const BOOKSHELF_CONFIG = fileURLToPath(
  new URL('../../../examples/bookshelf/triad.config.ts', import.meta.url),
);

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-frontend-'));
  tmpDirs.push(d);
  return d;
}

function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let stdout = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  return fn()
    .then((result) => ({ result, stdout }))
    .finally(() => {
      process.stdout.write = original;
    });
}

describe('runFrontendGenerate', () => {
  it('writes a TanStack Query client into the configured output directory', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: CONFIG_PATH,
        target: 'tanstack-query',
        output: out,
      }),
    );
    expect(stdout).toContain('TanStack Query client written');

    for (const name of ['types.ts', 'query-keys.ts', 'client.ts', 'index.ts']) {
      expect(fs.existsSync(path.join(out, name))).toBe(true);
    }

    const types = fs.readFileSync(path.join(out, 'types.ts'), 'utf8');
    expect(types).toContain('export interface Pet {');
    expect(types).toContain('export interface CreatePet {');
    expect(types).toContain('export interface ApiError {');

    const keys = fs.readFileSync(path.join(out, 'query-keys.ts'), 'utf8');
    expect(keys).toContain('export const petKeys');

    // One file per bounded context or root endpoints → find a file
    // with the hook source.
    const files = fs.readdirSync(out);
    const hookFile = files.find(
      (f) =>
        f.endsWith('.ts') &&
        !['types.ts', 'query-keys.ts', 'client.ts', 'index.ts'].includes(f),
    );
    expect(hookFile).toBeDefined();
    const hooks = fs.readFileSync(path.join(out, hookFile!), 'utf8');
    expect(hooks).toContain('useCreatePet');
    expect(hooks).toContain('@tanstack/react-query');
  });

  it('rejects unsupported targets', async () => {
    await expect(
      runFrontendGenerate({
        config: CONFIG_PATH,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: 'solid-query' as any,
        output: makeTmp(),
      }),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('writes a channel client into a channels/ subdirectory for the channel-client target', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'channel-client',
        output: out,
      }),
    );
    expect(stdout).toContain('Channel client written');
    const channelsDir = path.join(out, 'channels');
    expect(fs.existsSync(channelsDir)).toBe(true);
    for (const name of ['client.ts', 'types.ts', 'index.ts', 'book-reviews.ts']) {
      expect(fs.existsSync(path.join(channelsDir, name))).toBe(true);
    }
    const channelSrc = fs.readFileSync(
      path.join(channelsDir, 'book-reviews.ts'),
      'utf8',
    );
    expect(channelSrc).toContain('export function createBookReviewsClient');
  });

  it('writes both vanilla and React hook files for the channel-client-react target', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'channel-client-react',
        output: out,
      }),
    );
    expect(stdout).toContain('Channel client (React) written to');
    const channelsDir = path.join(out, 'channels');
    // Vanilla files (the React hooks depend on them)
    for (const name of [
      'client.ts',
      'types.ts',
      'index.ts',
      'book-reviews.ts',
    ]) {
      expect(fs.existsSync(path.join(channelsDir, name))).toBe(true);
    }
    // React-specific files
    expect(fs.existsSync(path.join(channelsDir, 'react-runtime.ts'))).toBe(true);
    expect(fs.existsSync(path.join(channelsDir, 'book-reviews-react.ts'))).toBe(
      true,
    );
    const hookSrc = fs.readFileSync(
      path.join(channelsDir, 'book-reviews-react.ts'),
      'utf8',
    );
    expect(hookSrc).toContain('export function useBookReviewsChannel');
    expect(hookSrc).toContain("from 'react'");
  });

  it('writes Solid hook files for the channel-client-solid target', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'channel-client-solid',
        output: out,
      }),
    );
    expect(stdout).toContain('Channel client (Solid) written to');
    const channelsDir = path.join(out, 'channels');
    for (const name of [
      'client.ts',
      'types.ts',
      'index.ts',
      'book-reviews.ts',
      'solid-runtime.ts',
      'book-reviews-solid.ts',
    ]) {
      expect(fs.existsSync(path.join(channelsDir, name))).toBe(true);
    }
    const hookSrc = fs.readFileSync(
      path.join(channelsDir, 'book-reviews-solid.ts'),
      'utf8',
    );
    expect(hookSrc).toContain('export function createBookReviewsChannel');
    expect(hookSrc).toContain("from 'solid-js'");
  });

  it('writes Vue hook files for the channel-client-vue target', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'channel-client-vue',
        output: out,
      }),
    );
    expect(stdout).toContain('Channel client (Vue) written to');
    const channelsDir = path.join(out, 'channels');
    for (const name of [
      'client.ts',
      'types.ts',
      'index.ts',
      'book-reviews.ts',
      'vue-runtime.ts',
      'book-reviews-vue.ts',
    ]) {
      expect(fs.existsSync(path.join(channelsDir, name))).toBe(true);
    }
    const hookSrc = fs.readFileSync(
      path.join(channelsDir, 'book-reviews-vue.ts'),
      'utf8',
    );
    expect(hookSrc).toContain('export function useBookReviewsChannel');
    expect(hookSrc).toContain("from 'vue'");
  });

  it('writes Svelte hook files for the channel-client-svelte target', async () => {
    const out = makeTmp();
    const { stdout } = await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'channel-client-svelte',
        output: out,
      }),
    );
    expect(stdout).toContain('Channel client (Svelte) written to');
    const channelsDir = path.join(out, 'channels');
    for (const name of [
      'client.ts',
      'types.ts',
      'index.ts',
      'book-reviews.ts',
      'svelte-runtime.ts',
      'book-reviews-svelte.ts',
    ]) {
      expect(fs.existsSync(path.join(channelsDir, name))).toBe(true);
    }
    const hookSrc = fs.readFileSync(
      path.join(channelsDir, 'book-reviews-svelte.ts'),
      'utf8',
    );
    expect(hookSrc).toContain('export function bookReviewsChannel');
    expect(hookSrc).toContain("from 'svelte'");
  });

  it('runs both targets when comma-separated', async () => {
    const out = makeTmp();
    await captureStdout(async () =>
      runFrontendGenerate({
        config: BOOKSHELF_CONFIG,
        target: 'tanstack-query,channel-client',
        output: out,
      }),
    );
    // HTTP hooks land at the top level
    expect(fs.existsSync(path.join(out, 'types.ts'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'client.ts'))).toBe(true);
    // Channel client lands in channels/
    expect(fs.existsSync(path.join(out, 'channels', 'book-reviews.ts'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'channels', 'client.ts'))).toBe(true);
  });

  it('honors --base-url when writing the runtime client', async () => {
    const out = makeTmp();
    await captureStdout(async () =>
      runFrontendGenerate({
        config: CONFIG_PATH,
        target: 'tanstack-query',
        output: out,
        baseUrl: '/v2',
      }),
    );
    const client = fs.readFileSync(path.join(out, 'client.ts'), 'utf8');
    expect(client).toContain('"/v2"');
  });
});
