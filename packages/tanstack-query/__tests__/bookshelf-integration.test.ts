/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the generator, writes
 * the files to a tmp directory, and finally type-checks them with the
 * TypeScript compiler API to prove the emitted code is valid TS (with
 * a stubbed `@tanstack/react-query` module so the compilation is
 * hermetic).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { Router } from '@triad/core';
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

describe('bookshelf integration', () => {
  it('generates hooks for every endpoint in bookshelf', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const allSource = files.map((f) => f.contents).join('\n');

    for (const ep of router.allEndpoints()) {
      // Each endpoint should produce exactly one hook — we just check
      // its name appears somewhere in the emitted hook files.
      const base = ep.name.charAt(0).toUpperCase() + ep.name.slice(1);
      const getById = ep.method === 'GET' && /^Get[A-Z]/.test(base);
      const expected = getById ? `use${base.slice(3)}` : `use${base}`;
      expect(allSource).toContain(`export function ${expected}`);
    }
  });

  it('emits every named model from bookshelf into types.ts', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const types = files.find((f) => f.path === 'types.ts')!.contents;
    for (const name of [
      'Book',
      'BookPage',
      'CreateBook',
      'UpdateBook',
      'Review',
      'CreateReview',
      'User',
      'RegisterInput',
      'LoginInput',
      'AuthResult',
      'ApiError',
    ]) {
      expect(types).toContain(`export interface ${name} {`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    const files = generate(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-tq-'));
    try {
      writeFiles(files, tmp);

      // Provide a tiny stub for @tanstack/react-query so tsc doesn't
      // need the real package installed.
      const stubDir = path.join(tmp, 'stubs', '@tanstack', 'react-query');
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(
        path.join(stubDir, 'index.d.ts'),
        `
export type UseQueryOptions<TData, TError> = {
  queryKey?: unknown;
  queryFn?: unknown;
  enabled?: boolean;
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
};
export type UseQueryResult<TData, TError> = { data: TData | undefined; error: TError | null; isLoading: boolean };
export type UseMutationOptions<TData, TError, TVariables> = {
  mutationFn?: unknown;
  onSuccess?: (data: TData, variables: TVariables, context: unknown) => void;
  onError?: (error: TError, variables: TVariables, context: unknown) => void;
};
export type UseMutationResult<TData, TError, TVariables> = {
  mutate: (variables: TVariables) => void;
  data: TData | undefined;
  error: TError | null;
};
export declare function useQuery<TData, TError>(opts: UseQueryOptions<TData, TError> & { queryKey: unknown; queryFn: () => Promise<TData> }): UseQueryResult<TData, TError>;
export declare function useMutation<TData, TError, TVariables>(opts: UseMutationOptions<TData, TError, TVariables> & { mutationFn: (vars: TVariables) => Promise<TData> }): UseMutationResult<TData, TError, TVariables>;
export declare function useQueryClient(): { invalidateQueries: (opts: { queryKey: unknown }) => void };
`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(stubDir, 'package.json'),
        JSON.stringify({ name: '@tanstack/react-query', types: 'index.d.ts' }),
        'utf8',
      );

      // Write a tsconfig pointing at the stubs via paths.
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          esModuleInterop: true,
          lib: ['ES2022', 'DOM'],
          baseUrl: '.',
          paths: {
            '@tanstack/react-query': ['./stubs/@tanstack/react-query/index.d.ts'],
          },
        },
        include: [
          ...files.map((f) => `./${f.path}`),
        ],
      };
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify(tsconfig), 'utf8');

      // Run a programmatic compilation.
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
          '@tanstack/react-query': [path.join(tmp, 'stubs/@tanstack/react-query/index.d.ts')],
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => {
        // Ignore diagnostics that originate from files OUTSIDE the tmp
        // dir — TypeScript's lib files or third-party stubs.
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
        throw new Error(`Generated code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
