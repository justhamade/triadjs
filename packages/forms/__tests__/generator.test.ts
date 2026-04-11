import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import { generate } from '../src/generator.js';

const Book = t.model('Book', {
  id: t.string(),
  title: t.string(),
  year: t.int32(),
});

const CreateBook = t.model('CreateBook', {
  title: t.string(),
  year: t.int32(),
});

const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Create',
  request: { body: CreateBook },
  responses: { 201: { schema: Book, description: 'Created' } },
  handler: async (ctx) => ctx.respond[201]({ id: '1', title: 't', year: 2020 }),
});

const listBooks = endpoint({
  name: 'listBooks',
  method: 'GET',
  path: '/books',
  summary: 'List',
  request: {},
  responses: {
    200: {
      schema: t.model('BookList', { items: t.array(Book) }),
      description: 'OK',
    },
  },
  handler: async (ctx) => ctx.respond[200]({ items: [] }),
});

function mkRouter() {
  const r = createRouter({ title: 'Test', version: '1.0.0' });
  r.context('Library', { description: 'books' }, (ctx) => {
    ctx.add(createBook, listBooks);
  });
  return r;
}

describe('forms generator', () => {
  it('emits a runtime.ts with validateWith', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const runtime = files.find((f) => f.path === 'runtime.ts');
    expect(runtime).toBeDefined();
    expect(runtime!.contents).toContain('export function validateWith');
    expect(runtime!.contents).toContain('ValidationResult');
  });

  it('emits a validator per endpoint body', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const library = files.find((f) => f.path === 'library.ts');
    expect(library).toBeDefined();
    expect(library!.contents).toContain('export function validateCreateBook');
    expect(library!.contents).toContain('validateWith<CreateBook>');
  });

  it('embeds the schema descriptor as a JSON constant', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const library = files.find((f) => f.path === 'library.ts')!;
    expect(library.contents).toContain('validateCreateBookDescriptor');
    expect(library.contents).toContain('"kind": "object"');
    expect(library.contents).toContain('"title"');
    expect(library.contents).toContain('"year"');
  });

  it('does not emit a validator for endpoints without a body', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const library = files.find((f) => f.path === 'library.ts')!;
    expect(library.contents).not.toContain('validateListBooks');
  });

  it('emits types.ts with the body type', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const types = files.find((f) => f.path === 'types.ts')!;
    expect(types.contents).toContain('export interface CreateBook {');
  });

  it('opts into react-hook-form.ts when reactHookForm: true', () => {
    const files = generate(mkRouter(), {
      outputDir: '/tmp/x',
      reactHookForm: true,
    });
    const rhf = files.find((f) => f.path === 'react-hook-form.ts');
    expect(rhf).toBeDefined();
    expect(rhf!.contents).toContain('createBookResolver');
    expect(rhf!.contents).toContain("from './library.js'");
  });

  it('opts into tanstack-form.ts when tanstackForm: true', () => {
    const files = generate(mkRouter(), {
      outputDir: '/tmp/x',
      tanstackForm: true,
    });
    const tf = files.find((f) => f.path === 'tanstack-form.ts');
    expect(tf).toBeDefined();
    expect(tf!.contents).toContain('createBookValidator');
  });

  it('omits resolver files when not requested', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    expect(files.find((f) => f.path === 'react-hook-form.ts')).toBeUndefined();
    expect(files.find((f) => f.path === 'tanstack-form.ts')).toBeUndefined();
  });

  it('barrel index.ts re-exports runtime + types + per-context validators', () => {
    const files = generate(mkRouter(), { outputDir: '/tmp/x' });
    const index = files.find((f) => f.path === 'index.ts')!;
    expect(index.contents).toContain(`export * from './runtime.js';`);
    expect(index.contents).toContain(`export * from './types.js';`);
    expect(index.contents).toContain(`export * from './library.js';`);
  });
});
