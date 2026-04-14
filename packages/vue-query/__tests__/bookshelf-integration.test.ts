/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the Vue Query
 * generator, writes files to a tmp directory, drops `.d.ts` stubs
 * for `@tanstack/vue-query` and `vue`, and type-checks with
 * `strict: true`.
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

describe('bookshelf vue-query integration', () => {
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
    for (const name of ['Book', 'BookPage', 'CreateBook', 'User', 'Review']) {
      expect(types).toContain(`export interface ${name} {`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-vq-'));
    try {
      writeFiles(files, tmp);

      const vqStub = path.join(tmp, 'stubs', '@tanstack', 'vue-query');
      fs.mkdirSync(vqStub, { recursive: true });
      fs.writeFileSync(
        path.join(vqStub, 'index.d.ts'),
        `
export type UseQueryOptions<TData, TError> = {
  queryKey?: unknown;
  queryFn?: unknown;
  enabled?: boolean;
};
export type UseMutationOptions<TData, TError, TVariables> = {
  mutationFn?: unknown;
  onSuccess?: (data: TData, variables: TVariables, context: unknown) => void;
  onError?: (error: TError, variables: TVariables, context: unknown) => void;
};
export type UseQueryReturnType<TData, TError> = { data: TData | undefined; error: TError | null };
export type UseMutationReturnType<TData, TError, TVariables> = { mutate: (v: TVariables) => void };
export declare function useQuery<TData, TError>(
  opts: UseQueryOptions<TData, TError> & { queryKey: unknown; queryFn: () => Promise<TData> },
): UseQueryReturnType<TData, TError>;
export declare function useMutation<TData, TError, TVariables>(
  opts: UseMutationOptions<TData, TError, TVariables> & { mutationFn: (v: TVariables) => Promise<TData> },
): UseMutationReturnType<TData, TError, TVariables>;
export declare function useQueryClient(): { invalidateQueries: (opts: { queryKey: unknown }) => void };
`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(vqStub, 'package.json'),
        JSON.stringify({ name: '@tanstack/vue-query', types: 'index.d.ts' }),
        'utf8',
      );

      const vueStubDir = path.join(tmp, 'stubs', 'vue');
      fs.mkdirSync(vueStubDir, { recursive: true });
      fs.writeFileSync(
        path.join(vueStubDir, 'index.d.ts'),
        `
export type MaybeRefOrGetter<T> = T | (() => T) | { value: T };
export interface ComputedRef<T> { readonly value: T; }
export declare function toValue<T>(source: MaybeRefOrGetter<T>): T;
export declare function computed<T>(fn: () => T): ComputedRef<T>;
`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(vueStubDir, 'package.json'),
        JSON.stringify({ name: 'vue', types: 'index.d.ts' }),
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
          '@tanstack/vue-query': [path.join(tmp, 'stubs/@tanstack/vue-query/index.d.ts')],
          'vue': [path.join(tmp, 'stubs/vue/index.d.ts')],
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
        throw new Error(`Generated Vue Query code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
