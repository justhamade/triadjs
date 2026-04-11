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
