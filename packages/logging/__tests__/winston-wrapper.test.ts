import { describe, it, expect } from 'vitest';
import { createWinstonLogger } from '../src/index.js';

type WinstonCall = { level: string; message: string; meta: Record<string, unknown> };

function createFakeWinston(
  bindings: Record<string, unknown> = {},
  shared?: WinstonCall[],
): {
  calls: WinstonCall[];
  instance: {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    child: (opts: Record<string, unknown>) => unknown;
  };
} {
  const calls: WinstonCall[] = shared ?? [];
  const mk =
    (level: string) =>
    (msg: string, meta: Record<string, unknown> = {}) => {
      calls.push({ level, message: msg, meta: { ...bindings, ...meta } });
    };
  const instance = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    child: (opts: Record<string, unknown>) =>
      createFakeWinston({ ...bindings, ...opts }, calls).instance,
  };
  return { calls, instance };
}

describe('createWinstonLogger', () => {
  it('forwards info with (message, meta) argument order', () => {
    const fake = createFakeWinston();
    const logger = createWinstonLogger(fake.instance);
    logger.info('hi', { user: 'x' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.level).toBe('info');
    expect(fake.calls[0]!.message).toBe('hi');
    expect(fake.calls[0]!.meta['user']).toBe('x');
  });

  it('forwards debug/warn/error', () => {
    const fake = createFakeWinston();
    const logger = createWinstonLogger(fake.instance);
    logger.debug('d');
    logger.warn('w');
    logger.error('e', { k: 1 });
    expect(fake.calls.map((c) => c.level)).toEqual(['debug', 'warn', 'error']);
    expect(fake.calls[2]!.meta['k']).toBe(1);
  });

  it('child() calls winston.child and bindings appear on calls', () => {
    const fake = createFakeWinston();
    const logger = createWinstonLogger(fake.instance);
    const child = logger.child({ request_id: 'r1' });
    child.info('hit');
    expect(fake.calls[0]!.meta['request_id']).toBe('r1');
    expect(fake.calls[0]!.message).toBe('hit');
  });

  it('handles missing meta', () => {
    const fake = createFakeWinston();
    const logger = createWinstonLogger(fake.instance);
    logger.info('no-meta');
    expect(fake.calls[0]!.message).toBe('no-meta');
    expect(fake.calls[0]!.meta).toEqual({});
  });

  it('throws if the instance does not look like winston', () => {
    expect(() => createWinstonLogger({} as unknown)).toThrow(/winston/i);
    expect(() => createWinstonLogger(undefined as unknown)).toThrow(/winston/i);
  });
});
