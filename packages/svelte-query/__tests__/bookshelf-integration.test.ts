/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the Svelte Query
 * generator, writes files to a tmp directory, drops a `.d.ts` stub
 * for `@tanstack/svelte-query`, and type-checks with `strict: true`.
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
import { svelteFactoryName } from '../src/hook-generator.js';

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

describe('bookshelf svelte-query integration', () => {
  it('generates a store factory for every endpoint', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const allSource = files.map((f) => f.contents).join('\n');
    for (const ep of router.allEndpoints()) {
      const expected = svelteFactoryName(ep);
      expect(allSource).toContain(`export function ${expected}`);
    }
  });

  it('emits every named model into types.ts', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const types = files.find((f) => f.path === 'types.ts')!.contents;
    for (const name of ['Book', 'BookPage', 'CreateBook', 'User', 'Review']) {
      expect(types).toContain(`export interface ${name} {`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-svq-'));
    try {
      writeFiles(files, tmp);

      const stubDir = path.join(tmp, 'stubs', '@tanstack', 'svelte-query');
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(
        path.join(stubDir, 'index.d.ts'),
        `
export type CreateQueryOptions<TData, TError> = {
  queryKey?: unknown;
  queryFn?: unknown;
  enabled?: boolean;
};
export type CreateMutationOptions<TData, TError, TVariables> = {
  mutationFn?: unknown;
  onSuccess?: (data: TData, variables: TVariables, context: unknown) => void;
  onError?: (error: TError, variables: TVariables, context: unknown) => void;
};
export type CreateQueryResult<TData, TError> = { subscribe: (run: (value: { data: TData | undefined; error: TError | null }) => void) => () => void };
export type CreateMutationResult<TData, TError, TVariables> = { mutate: (v: TVariables) => void };
export declare function createQuery<TData, TError>(
  opts: CreateQueryOptions<TData, TError> & { queryKey: unknown; queryFn: () => Promise<TData> },
): CreateQueryResult<TData, TError>;
export declare function createMutation<TData, TError, TVariables>(
  opts: CreateMutationOptions<TData, TError, TVariables> & { mutationFn: (v: TVariables) => Promise<TData> },
): CreateMutationResult<TData, TError, TVariables>;
export declare function useQueryClient(): { invalidateQueries: (opts: { queryKey: unknown }) => void };
`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(stubDir, 'package.json'),
        JSON.stringify({ name: '@tanstack/svelte-query', types: 'index.d.ts' }),
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
          '@tanstack/svelte-query': [path.join(tmp, 'stubs/@tanstack/svelte-query/index.d.ts')],
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
        throw new Error(`Generated Svelte Query code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
