/**
 * Write generated feature files to disk.
 *
 * Kept in its own module so the pure generator (`generator.ts`) has no
 * Node.js dependency — callers who want to diff in memory, serve over
 * HTTP, or pipe to another tool use `generateGherkin()` directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FeatureFile } from './generator.js';

export interface WriteOptions {
  /** Create the output directory if it does not exist (default: true). */
  createDir?: boolean;
}

/**
 * Write feature files to `outDir`. Returns the list of absolute paths that
 * were written.
 */
export function writeGherkinFiles(
  files: FeatureFile[],
  outDir: string,
  options: WriteOptions = {},
): string[] {
  const { createDir = true } = options;

  if (createDir) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const written: string[] = [];
  for (const file of files) {
    const abs = path.resolve(outDir, file.filename);
    fs.writeFileSync(abs, file.content, 'utf8');
    written.push(abs);
  }
  return written;
}
