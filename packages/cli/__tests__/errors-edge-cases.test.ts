/**
 * Phase 24 — behavior-coverage audit: CliError and load-config edge cases.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../src/errors.js';
import { loadConfig } from '../src/load-config.js';
import { runNew } from '../src/commands/new.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cli-edge-'));
}

describe('CliError — defaults and overrides', () => {
  it('maps CONFIG_NOT_FOUND to exit code 2 by default', () => {
    expect(new CliError('x', 'CONFIG_NOT_FOUND').exitCode).toBe(2);
  });

  it('maps TESTS_FAILED to exit code 1 by default', () => {
    expect(new CliError('x', 'TESTS_FAILED').exitCode).toBe(1);
  });

  it('maps VALIDATION_FAILED to exit code 1 by default', () => {
    expect(new CliError('x', 'VALIDATION_FAILED').exitCode).toBe(1);
  });

  it('maps DOCS_BREAKING_CHANGE to exit code 1 by default', () => {
    expect(new CliError('x', 'DOCS_BREAKING_CHANGE').exitCode).toBe(1);
  });

  it('maps TARGET_EXISTS to exit code 2 by default', () => {
    expect(new CliError('x', 'TARGET_EXISTS').exitCode).toBe(2);
  });

  it('accepts an explicit exit code override', () => {
    expect(new CliError('x', 'TESTS_FAILED', 7).exitCode).toBe(7);
  });

  it('preserves the code field for downstream dispatch', () => {
    const err = new CliError('boom', 'INVALID_ROUTER');
    expect(err.code).toBe('INVALID_ROUTER');
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('boom');
  });

  it('is an instanceof Error', () => {
    expect(new CliError('x', 'CONFIG_INVALID')).toBeInstanceOf(Error);
  });
});

describe('loadConfig — edge cases', () => {
  it('rejects a config file that default-exports a non-object', async () => {
    const dir = tempDir();
    try {
      const cfgPath = path.join(dir, 'triad.config.ts');
      fs.writeFileSync(cfgPath, 'export default "not-an-object";\n');
      await expect(loadConfig(cfgPath)).rejects.toMatchObject({
        name: 'CliError',
        code: 'CONFIG_INVALID',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves an explicit relative path against the supplied cwd', async () => {
    const dir = tempDir();
    try {
      const cfgPath = path.join(dir, 'triad.config.ts');
      fs.writeFileSync(cfgPath, "export default { router: './x.ts' };\n");
      const loaded = await loadConfig('triad.config.ts', dir);
      expect(loaded.configPath).toBe(cfgPath);
      expect(loaded.configDir).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws CONFIG_NOT_FOUND for a nonexistent explicit path', async () => {
    await expect(
      loadConfig('/tmp/definitely-does-not-exist/triad.config.ts'),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
  });
});

describe('runNew — edge cases', () => {
  it('throws SCAFFOLD_FAILED when a valid template name is supplied but no project path', async () => {
    // Capture stdout so the template list doesn't leak into test output.
    const originalOut = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = () => true;
    try {
      await expect(
        runNew({ template: 'fastify-petstore' }),
      ).rejects.toMatchObject({
        name: 'CliError',
        code: 'SCAFFOLD_FAILED',
      });
    } finally {
      process.stdout.write = originalOut;
    }
  });

  it('accepts a target directory that exists but is empty', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'empty-target');
    fs.mkdirSync(target);
    const originalOut = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = () => true;
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
      expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
    } finally {
      process.stdout.write = originalOut;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
