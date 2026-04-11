/**
 * `triad docs check` — breaking-change detection against an OpenAPI
 * baseline (a file path or a git ref).
 *
 * The command generates a fresh OpenAPI document from the current
 * router, loads a baseline document from disk or git, runs them
 * through `diffOpenAPI`, and prints a classified report. It exits
 * non-zero when any breaking changes are detected, unless the user
 * passed `--allow-breaking`.
 *
 * Git access is injected via a `readGitRef` hook so tests can exercise
 * the file-based path without shelling out.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import pc from 'picocolors';
import { generateOpenAPI } from '@triad/openapi';
import type { Router } from '@triad/core';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';
import { diffOpenAPI, classifyDiff, type DiffResult } from '../openapi-diff.js';

export interface DocsCheckOptions {
  config?: string;
  router?: Router | string;
  against?: string;
  allowBreaking?: boolean;
  /** Injected for tests — read a path at a given git ref. */
  readGitRef?: (ref: string, relPath: string) => string | undefined;
}

const DEFAULT_BASELINE_REF = 'main';
const DEFAULT_DOCS_PATH = './generated/openapi.yaml';

export async function runDocsCheck(opts: DocsCheckOptions): Promise<void> {
  const router = await resolveRouter(opts);
  const currentDoc = generateOpenAPI(router);

  const baselineInfo = loadBaseline(opts);
  const baselineDoc = parseDocument(baselineInfo.content, baselineInfo.label);

  const diff = diffOpenAPI(baselineDoc, currentDoc as unknown);
  reportDiff(diff, baselineInfo.label);

  const classification = classifyDiff(diff);
  if (classification.hasBreaking && !opts.allowBreaking) {
    throw new CliError(
      `${diff.breaking.length} breaking change(s) detected against ${baselineInfo.label}.`,
      'DOCS_BREAKING_CHANGE',
    );
  }
}

async function resolveRouter(opts: DocsCheckOptions): Promise<Router> {
  // Tests pass a pre-built router. The CLI path loads one from config.
  if (opts.router && typeof opts.router !== 'string') {
    return opts.router;
  }
  const loaded = await loadConfig(opts.config);
  const routerOpt =
    typeof opts.router === 'string' ? { router: opts.router } : undefined;
  return loadRouter(loaded, routerOpt);
}

interface BaselineInfo {
  readonly content: string;
  readonly label: string;
}

function loadBaseline(opts: DocsCheckOptions): BaselineInfo {
  const against = opts.against ?? DEFAULT_BASELINE_REF;
  if (isFilePath(against)) {
    const absPath = path.resolve(process.cwd(), against);
    if (!fs.existsSync(absPath)) {
      throw new CliError(
        `Baseline file not found: ${absPath}`,
        'BASELINE_NOT_FOUND',
      );
    }
    return { content: fs.readFileSync(absPath, 'utf8'), label: absPath };
  }
  // Git ref path.
  const readGitRef = opts.readGitRef ?? defaultReadGitRef;
  const content = readGitRef(against, DEFAULT_DOCS_PATH);
  if (content === undefined) {
    throw new CliError(
      `Could not read ${DEFAULT_DOCS_PATH} at git ref "${against}". Commit the generated docs or pass --against <file>.`,
      'BASELINE_NOT_FOUND',
    );
  }
  return { content, label: `git:${against}` };
}

function isFilePath(s: string): boolean {
  return (
    s.includes('/') ||
    s.endsWith('.yaml') ||
    s.endsWith('.yml') ||
    s.endsWith('.json')
  );
}

function defaultReadGitRef(ref: string, relPath: string): string | undefined {
  try {
    return execSync(`git show ${ref}:${relPath}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
  } catch {
    return undefined;
  }
}

function parseDocument(content: string, label: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new CliError(
      `Baseline ${label} is empty.`,
      'BASELINE_NOT_FOUND',
    );
  }
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new CliError(
        `Failed to parse baseline JSON at ${label}: ${errMessage(err)}`,
        'BASELINE_NOT_FOUND',
      );
    }
  }
  try {
    return parseYaml(content);
  } catch (err) {
    throw new CliError(
      `Failed to parse baseline YAML at ${label}: ${errMessage(err)}`,
      'BASELINE_NOT_FOUND',
    );
  }
}

function reportDiff(diff: DiffResult, baselineLabel: string): void {
  const { safe, risky, breaking } = diff;
  const total = safe.length + risky.length + breaking.length;
  process.stdout.write(
    `${pc.bold('Comparing')} current → ${pc.bold(baselineLabel)}\n\n`,
  );
  if (total === 0) {
    process.stdout.write(`${pc.green('✓')} No changes detected.\n`);
    return;
  }
  if (breaking.length > 0) {
    process.stdout.write(`${pc.red(pc.bold(`BREAKING (${breaking.length}):`))}\n`);
    for (const c of breaking) process.stdout.write(`  - ${c.message}\n`);
    process.stdout.write('\n');
  }
  if (risky.length > 0) {
    process.stdout.write(`${pc.yellow(pc.bold(`RISKY (${risky.length}):`))}\n`);
    for (const c of risky) process.stdout.write(`  - ${c.message}\n`);
    process.stdout.write('\n');
  }
  if (safe.length > 0) {
    process.stdout.write(`${pc.green(pc.bold(`SAFE (${safe.length}):`))}\n`);
    for (const c of safe) process.stdout.write(`  - ${c.message}\n`);
    process.stdout.write('\n');
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
