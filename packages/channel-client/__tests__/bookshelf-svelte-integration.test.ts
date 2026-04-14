/**
 * End-to-end integration test against the bookshelf example router
 * for the Svelte hook target.
 *
 * Loads the real bookshelf router via jiti, runs the generator with
 * `target: 'channel-client-svelte'`, writes the files to a tmp dir,
 * drops minimal `svelte` and `svelte/store` type stubs alongside
 * the generated files, and type-checks everything with the
 * TypeScript compiler API under `strict: true`.
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

const SVELTE_STUB = `
declare module 'svelte/store' {
  export interface Readable<T> {
    subscribe(cb: (value: T) => void): () => void;
  }
  export interface Writable<T> extends Readable<T> {
    set(value: T): void;
    update(fn: (value: T) => T): void;
  }
  export function writable<T>(value: T): Writable<T>;
  export function derived<T, U>(
    store: Readable<T>,
    fn: (value: T) => U,
  ): Readable<U>;
}
declare module 'svelte' {
  export function onDestroy(fn: () => void): void;
}
`;

describe('bookshelf channel-client-svelte integration', () => {
  it('emits a Svelte hook file per channel with the expected factory name', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-svelte',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('svelte-runtime.ts');
    for (const ch of router.allChannels()) {
      // Svelte factory name is lowercase-first camelCase: `<name>Channel`.
      const camel = ch.name.charAt(0).toLowerCase() + ch.name.slice(1);
      const kebab = ch.name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      const svelteFile = files.find((f) => f.path === `${kebab}-svelte.ts`);
      expect(svelteFile).toBeDefined();
      expect(svelteFile!.contents).toContain(
        `export function ${camel}Channel`,
      );
    }
  });

  it('still emits the vanilla client files alongside the Svelte hooks', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-svelte',
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('types.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('index.ts');
    expect(paths).toContain('book-reviews.ts');
  });

  it('type-checks the generated Svelte output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    if (router.allChannels().length === 0) return;
    const files = generateChannelClient(router, {
      outputDir: '/tmp/x',
      target: 'channel-client-svelte',
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cc-svelte-'));
    try {
      writeFiles(files, tmp);
      fs.writeFileSync(path.join(tmp, 'svelte.d.ts'), SVELTE_STUB, 'utf8');

      const tsFiles = [
        ...files.map((f) => path.join(tmp, f.path)),
        path.join(tmp, 'svelte.d.ts'),
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
        throw new Error(
          `Generated Svelte code failed to type-check:\n${formatted}`,
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
