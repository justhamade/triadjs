/**
 * End-to-end integration test against the bookshelf example router
 * for the React hook target.
 *
 * Loads the real bookshelf router via jiti, runs the generator with
 * `target: 'channel-client-react'`, writes the files to a tmp dir,
 * drops a minimal `react` type stub alongside the generated files,
 * and type-checks everything with the TypeScript compiler API. Proves
 * the emitted code compiles under `strict: true` with `jsx: 'react'`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { Router } from '@triadjs/core';
import ts from 'typescript';
import { generateChannelClient } from '../src/generator.js';
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

const REACT_STUB = `
declare module 'react' {
  export function useSyncExternalStore<Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot,
  ): Snapshot;
  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[],
  ): void;
  export function useRef<T>(initialValue: T): { current: T };
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}
`;

describe('bookshelf channel-client-react integration', () => {
  it('emits a React hook file per channel with the expected hook name', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-react',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('react-runtime.ts');
    for (const ch of router.allChannels()) {
      // camelCase name → PascalCase hook; file is kebab-case.
      const base = ch.name.charAt(0).toUpperCase() + ch.name.slice(1);
      const kebab = ch.name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      const reactFile = files.find((f) => f.path === `${kebab}-react.ts`);
      expect(reactFile).toBeDefined();
      expect(reactFile!.contents).toContain(`export function use${base}Channel`);
    }
  });

  it('still emits the vanilla client files alongside the React hooks', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-react',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('types.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('index.ts');
    expect(paths).toContain('book-reviews.ts');
  });

  it('type-checks the generated React output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    if (router.allChannels().length === 0) return;
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-react',
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cc-react-'));
    try {
      writeFiles(files, tmp);
      // Drop the react stub next to the generated files.
      fs.writeFileSync(path.join(tmp, 'react.d.ts'), REACT_STUB, 'utf8');

      const tsFiles = [
        ...files.map((f) => path.join(tmp, f.path)),
        path.join(tmp, 'react.d.ts'),
      ];
      const program = ts.createProgram(tsFiles, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => {
        const file = d.file?.fileName;
        if (file === undefined) return true;
        return file.startsWith(tmp);
      });
      if (diagnostics.length > 0) {
        const formatted = ts.formatDiagnosticsWithColorAndContext(
          diagnostics,
          {
            getCanonicalFileName: (f) => f,
            getCurrentDirectory: () => tmp,
            getNewLine: () => '\n',
          },
        );
        throw new Error(`Generated React code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
