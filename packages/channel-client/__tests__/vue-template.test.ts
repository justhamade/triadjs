/**
 * Vue runtime template smoke tests — parse the emitted source with
 * the TypeScript compiler API and assert there are zero syntactic
 * diagnostics. Also asserts the runtime exports the expected public
 * surface.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { renderVueRuntime } from '../src/vue-template.js';

describe('renderVueRuntime', () => {
  it('parses as syntactically valid TypeScript', () => {
    const source = renderVueRuntime();
    const sourceFile = ts.createSourceFile(
      'vue-runtime.ts',
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

  it('imports ref and Composition API primitives from vue', () => {
    const source = renderVueRuntime();
    expect(source).toContain("from 'vue'");
    expect(source).toContain('ref');
    expect(source).toContain('computed');
    expect(source).toContain('onBeforeUnmount');
  });

  it('exports useTriadChannelLifecycle', () => {
    const source = renderVueRuntime();
    expect(source).toContain('export function useTriadChannelLifecycle');
  });

  it('exports the UseTriadChannelResult type', () => {
    const source = renderVueRuntime();
    expect(source).toContain('export interface UseTriadChannelResult');
  });
});
