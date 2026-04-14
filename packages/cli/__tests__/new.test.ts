/**
 * Tests for `triad new` — scaffolding a new project from an example template.
 *
 * Each test runs the command against a temporary directory and asserts on
 * the files the command creates / rewrites. Because the source templates
 * are real example projects inside this monorepo, the tests double as
 * smoke tests of the example directories themselves.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runNew, TEMPLATES } from '../src/commands/new.js';
import { CliError } from '../src/errors.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-new-'));
});

afterEach(() => {
  if (fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

interface Capture {
  stdout: string;
  restore: () => void;
}

function captureOutput(): Capture {
  const cap: Capture = { stdout: '', restore: () => {} };
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    cap.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr.write as any) = (chunk: string | Uint8Array): boolean => {
    cap.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  cap.restore = () => {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  };
  return cap;
}

describe('runNew', () => {
  it('lists available templates when run without --template', async () => {
    const cap = captureOutput();
    try {
      await runNew({ projectPath: path.join(tmpRoot, 'project') });
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain('Available templates');
    for (const name of Object.keys(TEMPLATES)) {
      expect(cap.stdout).toContain(name);
    }
  });

  it('errors on an unknown template name', async () => {
    const cap = captureOutput();
    try {
      await expect(
        runNew({
          projectPath: path.join(tmpRoot, 'project'),
          template: 'not-a-real-template',
        }),
      ).rejects.toMatchObject({
        name: 'CliError',
        code: 'TEMPLATE_NOT_FOUND',
      });
    } finally {
      cap.restore();
    }
  });

  it('creates a project directory with expected files from fastify-petstore', async () => {
    const target = path.join(tmpRoot, 'my-petstore');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
    } finally {
      cap.restore();
    }
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'triad.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'src'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
  });

  it('rewrites the project name in package.json to match the target directory', async () => {
    const target = path.join(tmpRoot, 'my-cool-api');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
    } finally {
      cap.restore();
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cool-api');
    expect(pkg.private).toBeUndefined();
  });

  it('replaces workspace @triadjs/* deps with a version placeholder', async () => {
    const target = path.join(tmpRoot, 'rewritten');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
    } finally {
      cap.restore();
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<
      string,
      string
    >;
    for (const [name, version] of Object.entries(allDeps)) {
      if (name.startsWith('@triadjs/')) {
        expect(version).toBe('^0.1.0');
      }
    }
  });

  it('writes a README with the project name and template name', async () => {
    const target = path.join(tmpRoot, 'readme-check');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-bookshelf' });
    } finally {
      cap.restore();
    }
    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain('# readme-check');
    expect(readme).toContain('fastify-bookshelf');
  });

  it('errors when the target directory already exists with files', async () => {
    const target = path.join(tmpRoot, 'exists');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'stuff.txt'), 'nope');
    const cap = captureOutput();
    try {
      await expect(
        runNew({ projectPath: target, template: 'fastify-petstore' }),
      ).rejects.toMatchObject({
        name: 'CliError',
        code: 'TARGET_EXISTS',
      });
    } finally {
      cap.restore();
    }
  });

  it('overwrites an existing directory when --force is set', async () => {
    const target = path.join(tmpRoot, 'forced');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'old.txt'), 'old');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore', force: true });
    } finally {
      cap.restore();
    }
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
  });

  it('does not copy node_modules or dist', async () => {
    const target = path.join(tmpRoot, 'clean');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
    } finally {
      cap.restore();
    }
    expect(fs.existsSync(path.join(target, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'dist'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'generated'))).toBe(false);
  });

  it('prints a success message with next steps', async () => {
    const target = path.join(tmpRoot, 'success');
    const cap = captureOutput();
    try {
      await runNew({ projectPath: target, template: 'fastify-petstore' });
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain('success');
    expect(cap.stdout.toLowerCase()).toContain('cd ');
    expect(cap.stdout).toContain('npm install');
  });

  it('accepts all four known template names', () => {
    expect(Object.keys(TEMPLATES)).toEqual(
      expect.arrayContaining([
        'fastify-petstore',
        'express-tasktracker',
        'fastify-bookshelf',
        'hono-supabase',
      ]),
    );
  });
});

describe('CliError types', () => {
  it('is a CliError for known error shapes', () => {
    const err = new CliError('x', 'TEMPLATE_NOT_FOUND');
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(2);
  });
});
