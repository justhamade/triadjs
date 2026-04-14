/**
 * End-to-end integration test against the bookshelf example router
 * for the Vue hook target.
 *
 * Loads the real bookshelf router via jiti, runs the generator with
 * `target: 'channel-client-vue'`, writes the files to a tmp dir,
 * drops a minimal `vue` type stub alongside the generated files,
 * and type-checks everything with the TypeScript compiler API under
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

const VUE_STUB = `
declare module 'vue' {
  export interface Ref<T> { value: T; }
  export interface ComputedRef<T> { readonly value: T; }
  export function ref<T>(value: T): Ref<T>;
  export function computed<T>(fn: () => T): ComputedRef<T>;
  export function onMounted(fn: () => void): void;
  export function onBeforeUnmount(fn: () => void): void;
  export interface WatchOptions { immediate?: boolean; }
  export function watch<T>(
    source: Ref<T> | (() => T),
    cb: (value: T, oldValue: T | undefined, onCleanup: (fn: () => void) => void) => void,
    options?: WatchOptions,
  ): () => void;
}
`;

describe('bookshelf channel-client-vue integration', () => {
  it('emits a Vue hook file per channel with the expected hook name', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-vue',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('vue-runtime.ts');
    for (const ch of router.allChannels()) {
      const base = ch.name.charAt(0).toUpperCase() + ch.name.slice(1);
      const kebab = ch.name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      const vueFile = files.find((f) => f.path === `${kebab}-vue.ts`);
      expect(vueFile).toBeDefined();
      expect(vueFile!.contents).toContain(`export function use${base}Channel`);
    }
  });

  it('still emits the vanilla client files alongside the Vue hooks', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-vue',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('types.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('index.ts');
    expect(paths).toContain('book-reviews.ts');
  });

  it('type-checks the generated Vue output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    if (router.allChannels().length === 0) return;
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-vue',
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cc-vue-'));
    try {
      writeFiles(files, tmp);
      fs.writeFileSync(path.join(tmp, 'vue.d.ts'), VUE_STUB, 'utf8');

      const tsFiles = [
        ...files.map((f) => path.join(tmp, f.path)),
        path.join(tmp, 'vue.d.ts'),
      ];
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
        const formatted = ts.formatDiagnosticsWithColorAndContext(
          diagnostics,
          {
            getCanonicalFileName: (f) => f,
            getCurrentDirectory: () => tmp,
            getNewLine: () => '\n',
          },
        );
        throw new Error(`Generated Vue code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
