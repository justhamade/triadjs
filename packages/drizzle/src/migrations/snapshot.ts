/**
 * IR snapshot persistence.
 *
 * Converts a Triad router into a `RouterSnapshot` (by delegating to
 * the existing `walkRouter`), and provides deterministic JSON
 * serialization/parsing so on-disk snapshots diff cleanly in git and
 * can be compared byte-for-byte across runs.
 *
 * The stable JSON format sorts keys recursively. This matters for
 * two reasons:
 *
 *   1. `generateMigration` compares serialized snapshots during its
 *      "no changes" check (via the diff, but users may also diff
 *      the snapshot files manually).
 *   2. Git diffs of `.snapshot.json` should show only meaningful
 *      changes, not key-order noise produced by V8's insertion
 *      ordering quirks.
 */

import type { Router } from '@triadjs/core';
import { walkRouter } from '../codegen/walker.js';
import type { RouterSnapshot } from './types.js';

/**
 * Build a `RouterSnapshot` from a Triad router. Equivalent to
 * `walkRouter(router)` wrapped with the snapshot envelope.
 */
export function snapshotIR(router: Router): RouterSnapshot {
  return {
    version: 1,
    tables: walkRouter(router),
  };
}

/**
 * Serialize a snapshot to stable JSON (keys sorted recursively, 2-space
 * indent). The output is suitable for checking into git.
 */
export function serializeSnapshot(snapshot: RouterSnapshot): string {
  return `${stableStringify(snapshot, 2)}\n`;
}

/**
 * Parse a serialized snapshot. Throws if the text is not JSON, not an
 * object, missing `version`, or the version does not match the
 * current format (`1`).
 */
export function parseSnapshot(text: string): RouterSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid snapshot: not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid snapshot: expected an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(
      `Invalid snapshot: unsupported version (expected 1, got ${String(obj.version)})`,
    );
  }
  if (!Array.isArray(obj.tables)) {
    throw new Error('Invalid snapshot: "tables" must be an array');
  }
  return parsed as RouterSnapshot;
}

/**
 * JSON.stringify replacement that sorts object keys recursively. Arrays
 * preserve their order (TableDescriptor[] is order-sensitive: the
 * walker's insertion order is meaningful for deterministic output).
 */
function stableStringify(value: unknown, indent: number): string {
  return JSON.stringify(value, replacer, indent);

  function replacer(_key: string, val: unknown): unknown {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  }
}
