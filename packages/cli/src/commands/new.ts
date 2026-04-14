/**
 * `triad new` — scaffold a new project from one of the built-in
 * example templates.
 *
 * The templates map 1:1 to the example directories shipped inside the
 * Triad monorepo. Scaffolding copies the example tree (minus generated
 * / dev-only artifacts), rewrites `package.json` so workspace refs
 * resolve outside the monorepo, emits a fresh README, and optionally
 * runs `git init` to make the result feel like a real new project.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { CliError } from '../errors.js';

export interface TemplateInfo {
  readonly sourceDir: string;
  readonly description: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// At runtime the CLI lives at `packages/cli/(src|dist)/commands/new.*`,
// so the examples directory is four levels up in either case.
const EXAMPLES_DIR = path.resolve(MODULE_DIR, '../../../../examples');

export const TEMPLATES: Readonly<Record<string, TemplateInfo>> = {
  'fastify-petstore': {
    sourceDir: path.join(EXAMPLES_DIR, 'petstore'),
    description:
      'Fastify + Drizzle + WebSocket channels — the classic petstore API.',
  },
  'express-tasktracker': {
    sourceDir: path.join(EXAMPLES_DIR, 'tasktracker'),
    description:
      'Express + bearer auth + cursor pagination + ownership checks.',
  },
  'fastify-bookshelf': {
    sourceDir: path.join(EXAMPLES_DIR, 'bookshelf'),
    description:
      'Fastify + Drizzle + auth + channels + pagination — the feature-rich tutorial app.',
  },
  'hono-supabase': {
    sourceDir: path.join(EXAMPLES_DIR, 'supabase-edge'),
    description: 'Hono + Supabase + Deno edge function deployment.',
  },
};

export interface NewOptions {
  projectPath?: string;
  template?: string;
  force?: boolean;
}

export async function runNew(opts: NewOptions): Promise<void> {
  if (!opts.template) {
    printTemplateList();
    return;
  }

  const template = TEMPLATES[opts.template];
  if (!template) {
    const suggestion = nearestTemplate(opts.template);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    printTemplateList();
    throw new CliError(
      `Unknown template "${opts.template}".${hint}`,
      'TEMPLATE_NOT_FOUND',
    );
  }

  if (!opts.projectPath) {
    throw new CliError(
      'Missing project path. Usage: triad new <path> --template <name>',
      'SCAFFOLD_FAILED',
    );
  }

  const targetPath = path.resolve(process.cwd(), opts.projectPath);
  const projectName = sanitizeProjectName(path.basename(targetPath));

  if (fs.existsSync(targetPath)) {
    const existing = safeReadDir(targetPath);
    if (existing.length > 0 && !opts.force) {
      throw new CliError(
        `Target directory "${targetPath}" is not empty. Pass --force to overwrite.`,
        'TARGET_EXISTS',
      );
    }
  }

  if (!fs.existsSync(template.sourceDir)) {
    throw new CliError(
      `Template source directory not found: ${template.sourceDir}`,
      'SCAFFOLD_FAILED',
    );
  }

  fs.mkdirSync(targetPath, { recursive: true });
  copyTree(template.sourceDir, targetPath);
  rewritePackageJson(targetPath, projectName);
  writeReadme(targetPath, projectName, opts.template, template.description);
  tryGitInit(targetPath);

  process.stdout.write(
    `${pc.green('✓')} ${pc.bold(`Scaffold success`)} — created ${pc.bold(projectName)} from ${pc.bold(opts.template)}.\n` +
      `\n` +
      `  ${pc.dim(`cd ${path.relative(process.cwd(), targetPath) || '.'}`)}\n` +
      `  ${pc.dim('npm install')}\n` +
      `  ${pc.dim('npm start')}\n`,
  );
}

function printTemplateList(): void {
  process.stdout.write(`${pc.bold('Available templates:')}\n`);
  for (const [name, info] of Object.entries(TEMPLATES)) {
    process.stdout.write(`  ${pc.green(name)} — ${info.description}\n`);
  }
  process.stdout.write(
    `\nUsage: ${pc.bold('triad new <project-path> --template <name>')}\n`,
  );
}

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'generated', '.git']);
const EXCLUDE_FILES = new Set(['.gitignore']);

function copyTree(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDE_DIRS.has(entry.name)) continue;
    if (entry.isFile() && EXCLUDE_FILES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTree(srcPath, destPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rewritePackageJson(projectDir: string, projectName: string): void {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const raw = fs.readFileSync(pkgPath, 'utf8');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new CliError(
      `Failed to parse template package.json at ${pkgPath}: ${errMessage(err)}`,
      'SCAFFOLD_FAILED',
    );
  }
  pkg.name = projectName;
  delete pkg.private;
  // TODO(phase-21): Swap the `^0.1.0` placeholder for the real Triad
  // release version once @triadjs/* is published to npm. For now the
  // placeholder keeps template `package.json`s parseable and signals
  // to users which deps come from Triad.
  rewriteWorkspaceDeps(pkg, 'dependencies');
  rewriteWorkspaceDeps(pkg, 'devDependencies');
  rewriteWorkspaceDeps(pkg, 'peerDependencies');
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function rewriteWorkspaceDeps(
  pkg: Record<string, unknown>,
  field: string,
): void {
  const deps = pkg[field];
  if (!deps || typeof deps !== 'object') return;
  const entries = deps as Record<string, string>;
  for (const [name, version] of Object.entries(entries)) {
    if (name.startsWith('@triadjs/') && (version === '*' || version === 'workspace:*')) {
      entries[name] = '^0.1.0';
    }
  }
}

function writeReadme(
  projectDir: string,
  projectName: string,
  templateName: string,
  description: string,
): void {
  const content = `# ${projectName}

${description}

Created from the Triad \`${templateName}\` template.

## Getting started

\`\`\`bash
npm install
npm start
\`\`\`

## Useful commands

\`\`\`bash
npx triad docs       # Generate the OpenAPI document
npx triad gherkin    # Generate Gherkin .feature files
npx triad test       # Run every behavior as an in-process test
npx triad validate   # Cross-artifact consistency checks
\`\`\`

## Learn more

See the Triad project at https://github.com/justhamade/triad.
`;
  fs.writeFileSync(path.join(projectDir, 'README.md'), content);
}

function tryGitInit(projectDir: string): void {
  try {
    execSync('git init -q', { cwd: projectDir, stdio: 'ignore' });
  } catch {
    // Git isn't available — no harm, just skip.
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function sanitizeProjectName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'triad-app';
}

function nearestTemplate(input: string): string | undefined {
  const names = Object.keys(TEMPLATES);
  let best: { name: string; distance: number } | undefined;
  for (const name of names) {
    const d = editDistance(input, name);
    if (best === undefined || d < best.distance) best = { name, distance: d };
  }
  if (best && best.distance <= 5) return best.name;
  return undefined;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
