/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the Solid Query
 * generator, writes files to a tmp directory, drops a `.d.ts` stub
 * for `@tanstack/solid-query`, and type-checks with `strict: true`.
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

describe('bookshelf solid-query integration', () => {
  it('generates a hook for every endpoint', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const allSource = files.map((f) => f.contents).join('\n');
    for (const ep of router.allEndpoints()) {
      const base = ep.name.charAt(0).toUpperCase() + ep.name.slice(1);
      const getById = ep.method === 'GET' && /^Get[A-Z]/.test(base);
      const expected = getById ? `use${base.slice(3)}` : `use${base}`;
      expect(allSource).toContain(`export function ${expected}`);
    }
  });

  it('emits every named model into types.ts', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const types = files.find((f) => f.path === 'types.ts')!.contents;
    for (const name of ['Book', 'BookPage', 'CreateBook', 'UpdateBook', 'Review', 'User']) {
      expect(types).toContain(`export interface ${name} {`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-sq-'));
    try {
      writeFiles(files, tmp);

      // Stub for @tanstack/solid-query.
      const stubDir = path.join(tmp, 'stubs', '@tanstack', 'solid-query');
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(
        path.join(stubDir, 'index.d.ts'),
        `
export type SolidQueryOptions<TData, TError> = {
  queryKey?: unknown;
  queryFn?: unknown;
  enabled?: boolean;
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
};
export type SolidMutationOptions<TData, TError, TVariables> = {
  mutationFn?: unknown;
  onSuccess?: (data: TData, variables: TVariables, context: unknown) => void;
  onError?: (error: TError, variables: TVariables, context: unknown) => void;
};
export type CreateQueryResult<TData, TError> = { data: TData | undefined; error: TError | null };
export type CreateMutationResult<TData, TError, TVariables> = { mutate: (v: TVariables) => void; data: TData | undefined };
export declare function createQuery<TData, TError>(
  optionsFn: () => SolidQueryOptions<TData, TError> & { queryKey: unknown; queryFn: () => Promise<TData> },
): CreateQueryResult<TData, TError>;
export declare function createMutation<TData, TError, TVariables>(
  optionsFn: () => SolidMutationOptions<TData, TError, TVariables> & { mutationFn: (vars: TVariables) => Promise<TData> },
): CreateMutationResult<TData, TError, TVariables>;
export declare function useQueryClient(): { invalidateQueries: (opts: { queryKey: unknown }) => void };
`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(stubDir, 'package.json'),
        JSON.stringify({ name: '@tanstack/solid-query', types: 'index.d.ts' }),
        'utf8',
      );

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
        baseUrl: tmp,
        paths: {
          '@tanstack/solid-query': [path.join(tmp, 'stubs/@tanstack/solid-query/index.d.ts')],
        },
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
        throw new Error(`Generated Solid Query code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
