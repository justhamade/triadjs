/**
 * In-memory Logger implementation used by wrap-*.test.ts. Records every
 * call alongside the full merged context chain so tests can assert on
 * exactly what propagated.
 */

import type { Logger } from '../src/index.js';

export type FakeLogCall = {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
};

export class FakeLogger implements Logger {
  public readonly calls: FakeLogCall[];
  private readonly contextChain: Record<string, unknown>;

  constructor(
    contextChain: Record<string, unknown> = {},
    sharedCalls?: FakeLogCall[],
  ) {
    this.contextChain = contextChain;
    this.calls = sharedCalls ?? [];
  }

  private push(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.calls.push({
      level,
      message,
      context: { ...this.contextChain, ...(context ?? {}) },
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.push('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.push('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.push('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.push('error', message, context);
  }
  child(context: Record<string, unknown>): Logger {
    return new FakeLogger({ ...this.contextChain, ...context }, this.calls);
  }
}
