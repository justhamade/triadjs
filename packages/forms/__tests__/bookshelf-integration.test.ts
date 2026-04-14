/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the forms generator,
 * writes files to a tmp dir, and type-checks everything under
 * `strict: true` without any external stubs (the embedded runtime is
 * self-contained).
 *
 * Additionally dynamically imports the generated validator via jiti
 * and confirms that a valid `CreateBook` input is accepted and an
 * invalid one is rejected with structured errors.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { Router } from '@triadjs/core';
import ts from 'typescript';
import { generate } from '../src/generator.js';
import { writeFiles } from '../src/write.js';

const BOOKSHELF_APP = fileURLToPath(
  new URL('../../../examples/bookshelf/src/app.ts', import.meta.url),
);

async function loadBookshelfRouter(): Promise<Router> {
  const jiti = createJiti(BOOKSHELF_APP, { interopDefault: true });
  const mod = (await jiti.import(BOOKSHELF_APP, { default: true })) as unknown;
  if (!Router.isRouter(mod)) {
    throw new Error('Bookshelf app did not default-export a Router');
  }
  return mod;
}

describe('bookshelf forms integration', () => {
  it('generates a validateXxx for every endpoint with a body', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const allSource = files.map((f) => f.contents).join('\n');
    for (const ep of router.allEndpoints()) {
      if (ep.request.body === undefined) continue;
      const label = ep.name.charAt(0).toUpperCase() + ep.name.slice(1);
      expect(allSource).toContain(`export function validate${label}`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, {
      outputDir: '/tmp/x',
      reactHookForm: true,
      tanstackForm: true,
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-forms-'));
    try {
      writeFiles(files, tmp);
      const tsFiles = files.map((f) => path.join(tmp, f.path));
      const program = ts.createProgram(tsFiles, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => {
        const file = d.file?.fileName;
        if (file === undefined) return true;
        return file.startsWith(tmp);
      });
      if (diagnostics.length > 0) {
        const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (f) => f,
          getCurrentDirectory: () => tmp,
          getNewLine: () => '\n',
        });
        throw new Error(`Generated forms code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it('accepts a valid CreateBook and rejects an invalid one', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-forms-run-'));
    try {
      writeFiles(files, tmp);
      const libraryPath = path.join(tmp, 'library.ts');
      const jiti = createJiti(libraryPath, { interopDefault: true });
      const mod = (await jiti.import(libraryPath)) as {
        validateCreateBook: (input: unknown) => { ok: boolean; errors?: readonly { path: string; code: string }[] };
      };
      // A syntactically-correct CreateBook from the bookshelf example.
      const ok = mod.validateCreateBook({
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '978-0-441-17271-9',
        publishedYear: 1965,
      });
      expect(ok.ok).toBe(true);

      // Missing required `title`.
      const bad = mod.validateCreateBook({
        author: 'Frank Herbert',
        isbn: '978-0-441-17271-9',
        publishedYear: 1965,
      });
      expect(bad.ok).toBe(false);
      expect(bad.errors!.some((e) => e.path === 'title' && e.code === 'required')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
