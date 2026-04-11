/**
 * React runtime template smoke tests — parse the emitted source with
 * the TypeScript compiler API and assert there are zero syntactic
 * diagnostics. Also asserts the runtime exports the expected public
 * surface.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { renderReactRuntime } from '../src/react-template.js';

describe('renderReactRuntime', () => {
  it('parses as syntactically valid TypeScript', () => {
    const source = renderReactRuntime();
    const sourceFile = ts.createSourceFile(
      'react-runtime.ts',
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

  it('imports useSyncExternalStore from react', () => {
    const source = renderReactRuntime();
    expect(source).toContain("from 'react'");
    expect(source).toContain('useSyncExternalStore');
  });

  it('exports useTriadChannelLifecycle', () => {
    const source = renderReactRuntime();
    expect(source).toContain('export function useTriadChannelLifecycle');
  });

  it('exports the UseTriadChannelResult type', () => {
    const source = renderReactRuntime();
    expect(source).toContain('export interface UseTriadChannelResult');
  });
});
