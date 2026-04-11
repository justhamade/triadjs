/**
 * Svelte runtime template smoke tests — parse the emitted source with
 * the TypeScript compiler API and assert there are zero syntactic
 * diagnostics. Also asserts the runtime exports the expected public
 * surface.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { renderSvelteRuntime } from '../src/svelte-template.js';

describe('renderSvelteRuntime', () => {
  it('parses as syntactically valid TypeScript', () => {
    const source = renderSvelteRuntime();
    const sourceFile = ts.createSourceFile(
      'svelte-runtime.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const parseDiagnostics = (
      sourceFile as unknown as {
        parseDiagnostics: readonly ts.DiagnosticWithLocation[];
      }
    ).parseDiagnostics;
    expect(parseDiagnostics.length).toBe(0);
  });

  it('imports writable from svelte/store and onDestroy from svelte', () => {
    const source = renderSvelteRuntime();
    expect(source).toContain("from 'svelte/store'");
    expect(source).toContain("from 'svelte'");
    expect(source).toContain('writable');
    expect(source).toContain('onDestroy');
  });

  it('exports triadChannelLifecycle', () => {
    const source = renderSvelteRuntime();
    expect(source).toContain('export function triadChannelLifecycle');
  });

  it('exports the TriadChannelLifecycleResult type', () => {
    const source = renderSvelteRuntime();
    expect(source).toContain('export interface TriadChannelLifecycleResult');
  });
});
