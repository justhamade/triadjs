/**
 * Format a single `Behavior` into a Gherkin scenario block.
 *
 * Design rules (see docs/phase-4 notes):
 *   - The `given.description` becomes the `Given` step line.
 *   - If `given.body` is a plain object, it is rendered as an attached data
 *     table underneath the Given step.
 *   - `given.params`, `given.query`, `given.headers`, `given.setup`, and
 *     `given.fixtures` are NOT rendered in Gherkin — they are structured
 *     implementation details consumed by the Phase 5 test runner. The
 *     scenario title and step descriptions are what humans read.
 *   - Each entry in `behavior.then[]` renders as `Then <raw>` (first) or
 *     `And <raw>` (subsequent) using the original assertion text.
 *   - Data table values are stringified with simple rules: strings pass
 *     through, numbers/booleans use `String()`, null becomes `null`, and
 *     nested objects/arrays are JSON-stringified.
 */

import type { Behavior } from '@triad/core';

/** Render a single behavior to an array of indented Gherkin lines. */
export function formatScenario(behavior: Behavior, indent = 2): string[] {
  const pad = ' '.repeat(indent);
  const stepPad = ' '.repeat(indent + 2);
  const lines: string[] = [];

  lines.push(`${pad}Scenario: ${behavior.scenario}`);
  lines.push(`${stepPad}Given ${behavior.given.description}`);

  if (isPlainObject(behavior.given.body)) {
    const table = formatDataTable(
      behavior.given.body as Record<string, unknown>,
      indent + 4,
    );
    lines.push(...table);
  }

  lines.push(`${stepPad}When ${behavior.when.description}`);

  for (let i = 0; i < behavior.then.length; i++) {
    const keyword = i === 0 ? 'Then' : 'And';
    const assertion = behavior.then[i]!;
    lines.push(`${stepPad}${keyword} ${assertion.raw}`);
  }

  return lines;
}

/**
 * Render a flat object as a Gherkin data table (two columns: field, value).
 * Returns an empty array for empty objects so callers don't emit an orphan
 * header row.
 */
export function formatDataTable(
  obj: Record<string, unknown>,
  indent: number,
): string[] {
  const entries = Object.entries(obj);
  if (entries.length === 0) return [];

  const fieldHeader = 'field';
  const valueHeader = 'value';

  const fieldWidth = Math.max(
    fieldHeader.length,
    ...entries.map(([k]) => k.length),
  );
  const valueWidth = Math.max(
    valueHeader.length,
    ...entries.map(([, v]) => formatTableValue(v).length),
  );

  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  lines.push(
    `${pad}| ${fieldHeader.padEnd(fieldWidth)} | ${valueHeader.padEnd(valueWidth)} |`,
  );
  for (const [k, v] of entries) {
    lines.push(
      `${pad}| ${k.padEnd(fieldWidth)} | ${formatTableValue(v).padEnd(valueWidth)} |`,
    );
  }
  return lines;
}

/** Stringify a value for display in a Gherkin data table cell. */
export function formatTableValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Nested objects and arrays collapse to JSON.
  return JSON.stringify(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
