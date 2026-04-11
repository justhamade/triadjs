/**
 * Solid runtime template smoke tests — parse the emitted source with
 * the TypeScript compiler API and assert there are zero syntactic
 * diagnostics. Also asserts the runtime exports the expected public
 * surface.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { renderSolidRuntime } from '../src/solid-template.js';

describe('renderSolidRuntime', () => {
  it('parses as syntactically valid TypeScript', () => {
    const source = renderSolidRuntime();
    const sourceFile = ts.createSourceFile(
      'solid-runtime.ts',
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

  it('imports createSignal and friends from solid-js', () => {
    const source = renderSolidRuntime();
    expect(source).toContain("from 'solid-js'");
    expect(source).toContain('createSignal');
    expect(source).toContain('createEffect');
    expect(source).toContain('onCleanup');
  });

  it('exports createTriadChannelLifecycle', () => {
    const source = renderSolidRuntime();
    expect(source).toContain('export function createTriadChannelLifecycle');
  });

  it('exports the CreateTriadChannelResult type', () => {
    const source = renderSolidRuntime();
    expect(source).toContain('export interface CreateTriadChannelResult');
  });
});
