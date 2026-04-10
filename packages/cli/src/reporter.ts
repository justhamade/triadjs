/**
 * Terminal reporter for the `triad test` command.
 *
 * Renders a `RunSummary` to stdout with color-coded status icons and
 * scenario-grouped output. Colors use `picocolors` (tiny, zero deps). The
 * reporter is pure with respect to I/O: it takes a `write` callback so
 * tests can capture output instead of reading real stdout.
 */

import pc from 'picocolors';
import type { RunSummary, TestResult } from '@triad/test-runner';

/** Subset of picocolors we use. Keeping this narrow avoids coupling to the
 *  module's exact exported type, which varies across picocolors versions. */
interface Colorizer {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
}

export interface ReporterOptions {
  /** Write function — defaults to `process.stdout.write`. */
  write?: (chunk: string) => void;
  /** Force color on/off. Defaults to auto-detection via picocolors. */
  color?: boolean;
}

export function reportSummary(
  summary: RunSummary,
  options: ReporterOptions = {},
): void {
  const write = options.write ?? ((s: string) => process.stdout.write(s));
  const c: Colorizer =
    options.color === false ? noColor : (pc as unknown as Colorizer);

  const out: string[] = [];
  out.push('');

  // Group by endpoint (method + path + name).
  const byEndpoint = groupByEndpoint(summary.results);

  for (const [endpointHeading, results] of byEndpoint) {
    out.push(c.bold(endpointHeading));
    for (const r of results) {
      out.push(`  ${formatStatusLine(r, c)}`);
      if (r.status !== 'passed' && r.failure) {
        const detail = r.failure.message
          .split('\n')
          .map((line) => `      ${c.dim(line)}`)
          .join('\n');
        out.push(detail);
        if (r.failure.actualStatus !== undefined) {
          out.push(`      ${c.dim(`actual status: ${r.failure.actualStatus}`)}`);
        }
      }
    }
    out.push('');
  }

  out.push(formatSummaryLine(summary, c));
  out.push(c.dim(`Duration: ${summary.durationMs.toFixed(1)}ms`));
  out.push('');

  write(out.join('\n'));
}

function groupByEndpoint(
  results: readonly TestResult[],
): Map<string, TestResult[]> {
  const map = new Map<string, TestResult[]>();
  for (const r of results) {
    const key = `${r.method} ${r.path} — ${r.endpointName}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

function formatStatusLine(r: TestResult, c: Colorizer): string {
  const icon =
    r.status === 'passed'
      ? c.green('✓')
      : r.status === 'failed'
        ? c.red('✗')
        : r.status === 'errored'
          ? c.yellow('!')
          : c.dim('○');
  const scenario = r.status === 'passed' ? r.scenario : c.bold(r.scenario);
  return `${icon} ${scenario}`;
}

function formatSummaryLine(summary: RunSummary, c: Colorizer): string {
  const parts: string[] = [];
  if (summary.passed > 0) parts.push(c.green(`${summary.passed} passed`));
  if (summary.failed > 0) parts.push(c.red(`${summary.failed} failed`));
  if (summary.errored > 0) parts.push(c.yellow(`${summary.errored} errored`));
  if (summary.skipped > 0) parts.push(c.dim(`${summary.skipped} skipped`));
  if (parts.length === 0) parts.push(c.dim('no scenarios'));

  return c.bold(`${summary.total} scenarios — ${parts.join(', ')}`);
}

/** Fallback — used when the caller passes `color: false`. */
const noColor: Colorizer = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  red: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
};
