/**
 * End-to-end integration test against the bookshelf example router.
 *
 * Loads the real bookshelf router via jiti, runs the channel client
 * generator, writes the files to a tmp directory, and type-checks
 * them with the TypeScript compiler API to prove the emitted code
 * is valid under `strict: true`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { Router } from '@triad/core';
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

describe('bookshelf channel-client integration', () => {
  it('generates a file per channel with the expected factory', async () => {
    const router = await loadBookshelfRouter();
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    const joined = files.map((f) => f.contents).join('\n');
    for (const ch of router.allChannels()) {
      // channel name camelCase -> PascalCase -> factory.
      const base = ch.name.charAt(0).toUpperCase() + ch.name.slice(1);
      expect(joined).toContain(`export function create${base}Client`);
    }
  });

  it('type-checks the generated output with tsc --strict', async () => {
    const router = await loadBookshelfRouter();
    if (router.allChannels().length === 0) {
      // No channels to exercise — nothing to type-check.
      return;
    }
    const files = generateChannelClient(router, { outputDir: '/tmp/x' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cc-'));
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
        throw new Error(`Generated code failed to type-check:\n${formatted}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
