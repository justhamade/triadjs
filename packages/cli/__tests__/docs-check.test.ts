/**
 * Tests for `triad docs check` — breaking-change detection between a
 * freshly generated OpenAPI document and a baseline.
 *
 * The diff logic is tested in isolation against inline YAML fixtures;
 * the command itself is exercised against file-based baselines only
 * (git integration is covered by a tiny DI seam but not invoked here).
 */

import { describe, expect, it } from 'vitest';
import { diffOpenAPI, classifyDiff, type DiffResult } from '../src/openapi-diff.js';

const BASE_MIN: Record<string, unknown> = {
  openapi: '3.1.0',
  info: { title: 'x', version: '1.0.0' },
  paths: {
    '/books': {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('diffOpenAPI', () => {
  it('reports zero changes when documents are equal', () => {
    const diff = diffOpenAPI(BASE_MIN, clone(BASE_MIN));
    expect(diff.safe).toHaveLength(0);
    expect(diff.risky).toHaveLength(0);
    expect(diff.breaking).toHaveLength(0);
  });

  it('classifies a new endpoint as safe', () => {
    const next = clone(BASE_MIN);
    (next.paths as Record<string, unknown>)['/authors'] = {
      get: { responses: { '200': { description: 'ok' } } },
    };
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.safe.some((c) => c.message.includes('/authors'))).toBe(true);
    expect(diff.breaking).toHaveLength(0);
  });

  it('classifies a removed endpoint as breaking', () => {
    const next = clone(BASE_MIN);
    delete (next.paths as Record<string, unknown>)['/books'];
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.breaking.some((c) => c.message.includes('/books'))).toBe(true);
  });

  it('classifies removed method as breaking', () => {
    const next = clone(BASE_MIN);
    const books = (next.paths as Record<string, Record<string, unknown>>)['/books']!;
    delete books.get;
    books.post = { responses: { '200': { description: 'ok' } } };
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.breaking.length).toBeGreaterThan(0);
  });

  it('classifies a new optional field in response as safe', () => {
    const next = clone(BASE_MIN) as any;
    const props = next.paths['/books'].get.responses['200'].content[
      'application/json'
    ].schema.properties;
    props.description = { type: 'string' };
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.safe.some((c) => c.message.includes('description'))).toBe(true);
    expect(diff.breaking).toHaveLength(0);
  });

  it('classifies a removed response field as breaking', () => {
    const next = clone(BASE_MIN) as any;
    const schema =
      next.paths['/books'].get.responses['200'].content['application/json'].schema;
    delete schema.properties.title;
    schema.required = ['id'];
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.breaking.some((c) => c.message.includes('title'))).toBe(true);
  });

  it('classifies a new required request field as breaking', () => {
    const base = clone(BASE_MIN) as any;
    base.paths['/books'].post = {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title'],
              properties: { title: { type: 'string' } },
            },
          },
        },
      },
      responses: { '200': { description: 'ok' } },
    };
    const next = clone(base);
    next.paths['/books'].post.requestBody.content['application/json'].schema.required =
      ['title', 'isbn'];
    next.paths['/books'].post.requestBody.content[
      'application/json'
    ].schema.properties.isbn = { type: 'string' };
    const diff = diffOpenAPI(base, next);
    expect(diff.breaking.some((c) => c.message.toLowerCase().includes('isbn'))).toBe(
      true,
    );
  });

  it('classifies an enum value appended as safe', () => {
    const base = clone(BASE_MIN) as any;
    base.paths['/books'].get.responses['200'].content[
      'application/json'
    ].schema.properties.status = { type: 'string', enum: ['draft', 'published'] };
    const next = clone(base);
    next.paths['/books'].get.responses['200'].content[
      'application/json'
    ].schema.properties.status.enum = ['draft', 'published', 'returned'];
    const diff = diffOpenAPI(base, next);
    expect(diff.safe.some((c) => c.message.includes('returned'))).toBe(true);
    expect(diff.breaking).toHaveLength(0);
  });

  it('classifies an enum value removed as breaking', () => {
    const base = clone(BASE_MIN) as any;
    base.paths['/books'].get.responses['200'].content[
      'application/json'
    ].schema.properties.status = {
      type: 'string',
      enum: ['draft', 'published', 'returned'],
    };
    const next = clone(base);
    next.paths['/books'].get.responses['200'].content[
      'application/json'
    ].schema.properties.status.enum = ['draft', 'published'];
    const diff = diffOpenAPI(base, next);
    expect(diff.breaking.some((c) => c.message.includes('returned'))).toBe(true);
  });

  it('classifies a new status code as safe', () => {
    const next = clone(BASE_MIN) as any;
    next.paths['/books'].get.responses['404'] = { description: 'not found' };
    const diff = diffOpenAPI(BASE_MIN, next);
    expect(diff.safe.some((c) => c.message.includes('404'))).toBe(true);
  });

  it('classifies a removed status code as breaking', () => {
    const base = clone(BASE_MIN) as any;
    base.paths['/books'].get.responses['404'] = { description: 'nf' };
    const next = clone(BASE_MIN);
    const diff = diffOpenAPI(base, next);
    expect(diff.breaking.some((c) => c.message.includes('404'))).toBe(true);
  });
});

describe('classifyDiff', () => {
  it('returns exit code 1 when there are breaking changes', () => {
    const diff: DiffResult = {
      safe: [],
      risky: [],
      breaking: [{ severity: 'breaking', path: '/x', message: 'x' }],
    };
    expect(classifyDiff(diff).hasBreaking).toBe(true);
  });
  it('returns exit code 0 when there are no breaking changes', () => {
    const diff: DiffResult = {
      safe: [{ severity: 'safe', path: '/x', message: 'x' }],
      risky: [],
      breaking: [],
    };
    expect(classifyDiff(diff).hasBreaking).toBe(false);
  });
});

describe('runDocsCheck — command', () => {
  it('reads a file-based baseline and reports safely on a new endpoint', async () => {
    const { runDocsCheck } = await import('../src/commands/docs-check.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createRouter, endpoint, t } = await import('@triadjs/core');

    // Build a router with two endpoints; use it to produce a "current" doc.
    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const ep1 = endpoint({
      name: 'listPets',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: t.array(Pet), description: 'ok' } },
      handler: async () => ({ status: 200, body: [] }),
    });
    const ep2 = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);

    // Baseline = router WITHOUT ep2 (so adding it is a "safe" new endpoint).
    const baseRouter = createRouter({ title: 'x', version: '1' });
    baseRouter.add(ep1);
    const { generateOpenAPI, toYaml } = await import('@triadjs/openapi');
    const baseDoc = generateOpenAPI(baseRouter);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-check-'));
    const baselineFile = path.join(tmp, 'baseline.yaml');
    fs.writeFileSync(baselineFile, toYaml(baseDoc));

    // Redirect stdout.
    let captured = '';
    const original = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    };

    try {
      await runDocsCheck({
        router,
        against: baselineFile,
      });
    } finally {
      process.stdout.write = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    expect(captured).toContain('SAFE');
    expect(captured).toContain('/pets/{id}');
  });

  it('throws DOCS_BREAKING_CHANGE when a breaking change is detected', async () => {
    const { runDocsCheck } = await import('../src/commands/docs-check.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createRouter, endpoint, t } = await import('@triadjs/core');
    const { generateOpenAPI, toYaml } = await import('@triadjs/openapi');

    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const ep1 = endpoint({
      name: 'listPets',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: t.array(Pet), description: 'ok' } },
      handler: async () => ({ status: 200, body: [] }),
    });
    const baseRouter = createRouter({ title: 'x', version: '1' });
    baseRouter.add(ep1);
    const baseDoc = generateOpenAPI(baseRouter);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-check-'));
    const baselineFile = path.join(tmp, 'baseline.yaml');
    fs.writeFileSync(baselineFile, toYaml(baseDoc));

    // Current router is empty — so `listPets` has been removed.
    const router = createRouter({ title: 'x', version: '1' });

    const original = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = (_chunk: string | Uint8Array): boolean => true;

    try {
      await expect(
        runDocsCheck({ router, against: baselineFile }),
      ).rejects.toMatchObject({
        name: 'CliError',
        code: 'DOCS_BREAKING_CHANGE',
      });
    } finally {
      process.stdout.write = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits 0 with --allow-breaking', async () => {
    const { runDocsCheck } = await import('../src/commands/docs-check.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createRouter, endpoint, t } = await import('@triadjs/core');
    const { generateOpenAPI, toYaml } = await import('@triadjs/openapi');

    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const ep1 = endpoint({
      name: 'listPets',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: t.array(Pet), description: 'ok' } },
      handler: async () => ({ status: 200, body: [] }),
    });
    const baseRouter = createRouter({ title: 'x', version: '1' });
    baseRouter.add(ep1);
    const baseDoc = generateOpenAPI(baseRouter);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-check-'));
    const baselineFile = path.join(tmp, 'baseline.yaml');
    fs.writeFileSync(baselineFile, toYaml(baseDoc));

    const router = createRouter({ title: 'x', version: '1' });

    const original = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = (_chunk: string | Uint8Array): boolean => true;
    try {
      await runDocsCheck({ router, against: baselineFile, allowBreaking: true });
    } finally {
      process.stdout.write = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
