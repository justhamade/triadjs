/**
 * Runtime client-template smoke tests — parse the emitted source
 * with the TypeScript compiler API and assert there are zero
 * syntactic diagnostics.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { renderClientRuntime } from '../src/client-template.js';

describe('renderClientRuntime', () => {
  it('substitutes the default base URL into DEFAULT_BASE_URL', () => {
    const out = renderClientRuntime({ baseUrl: '/ws' });
    expect(out).toContain('export const DEFAULT_BASE_URL = "/ws";');
  });

  it('parses as syntactically valid TypeScript', () => {
    const source = renderClientRuntime({ baseUrl: '/' });
    const sourceFile = ts.createSourceFile(
      'client.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    // Using parseDiagnostics catches syntactic issues without a full program.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
    expect(parseDiagnostics.length).toBe(0);
  });

  it('exports the BaseChannelClient class and key types', () => {
    const source = renderClientRuntime({ baseUrl: '/' });
    expect(source).toContain('export class BaseChannelClient');
    expect(source).toContain('export type ChannelState');
    expect(source).toContain('export type AuthStrategy');
    expect(source).toContain('export interface BaseChannelClientOptions');
  });
});
