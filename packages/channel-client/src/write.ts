/**
 * Write a list of `GeneratedFile`s to disk, creating the output
 * directory if it doesn't exist. Idempotent — overwrites existing
 * files without prompting.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GeneratedFile } from './types.js';

export function writeFiles(
  files: readonly GeneratedFile[],
  outputDir: string,
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of files) {
    const target = path.resolve(outputDir, file.path);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, file.contents, 'utf8');
  }
}
