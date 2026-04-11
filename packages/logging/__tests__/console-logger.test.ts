import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConsoleLogger } from '../src/index.js';

type ConsoleCall = { method: string; args: unknown[] };

function captureConsole(): {
  calls: ConsoleCall[];
  restore: () => void;
} {
  const calls: ConsoleCall[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    log: console.log,
  };
  console.debug = (...args: unknown[]) => calls.push({ method: 'debug', args });
  console.info = (...args: unknown[]) => calls.push({ method: 'info', args });
  console.warn = (...args: unknown[]) => calls.push({ method: 'warn', args });
  console.error = (...args: unknown[]) => calls.push({ method: 'error', args });
  console.log = (...args: unknown[]) => calls.push({ method: 'log', args });
  return {
    calls,
    restore: () => {
      console.debug = original.debug;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.log = original.log;
    },
  };
}

describe('createConsoleLogger', () => {
  let cap: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    cap = captureConsole();
  });
  afterEach(() => {
    cap.restore();
  });

  it('emits one JSON line per log call', () => {
    const logger = createConsoleLogger();
    logger.info('hello', { a: 1 });
    expect(cap.calls).toHaveLength(1);
    const parsed = JSON.parse(cap.calls[0]!.args[0] as string) as Record<string, unknown>;
    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('hello');
    expect(parsed['a']).toBe(1);
  });

  it('tags level on each method', () => {
    const logger = createConsoleLogger({ level: 'debug' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    const levels = cap.calls.map(
      (c) => (JSON.parse(c.args[0] as string) as { level: string }).level,
    );
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('filters below the configured level', () => {
    const logger = createConsoleLogger({ level: 'warn' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(cap.calls).toHaveLength(2);
  });

  it('child() returns a logger that merges contexts into every call', () => {
    const logger = createConsoleLogger();
    const child = logger.child({ request_id: 'r1' });
    child.info('hello', { user_id: 'u1' });
    const parsed = JSON.parse(cap.calls[0]!.args[0] as string) as Record<string, unknown>;
    expect(parsed['request_id']).toBe('r1');
    expect(parsed['user_id']).toBe('u1');
    expect(parsed['message']).toBe('hello');
  });

  it('nested child calls merge parent + child contexts', () => {
    const logger = createConsoleLogger();
    const child1 = logger.child({ a: 1 });
    const child2 = child1.child({ b: 2 });
    child2.info('x', { c: 3 });
    const parsed = JSON.parse(cap.calls[0]!.args[0] as string) as Record<string, unknown>;
    expect(parsed['a']).toBe(1);
    expect(parsed['b']).toBe(2);
    expect(parsed['c']).toBe(3);
  });

  it('child context does not leak back to parent', () => {
    const logger = createConsoleLogger();
    const child = logger.child({ scoped: true });
    child.info('x');
    logger.info('y');
    const parsed0 = JSON.parse(cap.calls[0]!.args[0] as string) as Record<string, unknown>;
    const parsed1 = JSON.parse(cap.calls[1]!.args[0] as string) as Record<string, unknown>;
    expect(parsed0['scoped']).toBe(true);
    expect(parsed1['scoped']).toBeUndefined();
  });

  it('pretty mode emits human-readable lines with level and message', () => {
    const logger = createConsoleLogger({ pretty: true });
    logger.info('hello world', { a: 1 });
    const line = cap.calls[0]!.args[0] as string;
    expect(line).toContain('INFO');
    expect(line).toContain('hello world');
    expect(line).toContain('a=1');
  });
});
