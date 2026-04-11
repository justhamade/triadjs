import { describe, it, expect } from 'vitest';
import { createPinoLogger } from '../src/index.js';

type PinoCall = { level: string; obj: Record<string, unknown>; msg: string };

function createFakePino(contextChain: Record<string, unknown> = {}): {
  calls: PinoCall[];
  instance: {
    debug: (obj: Record<string, unknown>, msg: string) => void;
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
    child: (bindings: Record<string, unknown>) => unknown;
  };
} {
  const calls: PinoCall[] = [];
  const mk = (level: string) => (obj: Record<string, unknown>, msg: string) =>
    calls.push({ level, obj: { ...contextChain, ...obj }, msg });
  const instance = {
    debug: mk('debug'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    child: (bindings: Record<string, unknown>) => {
      const fake = createFakePino({ ...contextChain, ...bindings });
      // share the calls array so child calls land in the same log
      fake.instance.debug = (obj: Record<string, unknown>, msg: string) =>
        calls.push({
          level: 'debug',
          obj: { ...contextChain, ...bindings, ...obj },
          msg,
        });
      fake.instance.info = (obj: Record<string, unknown>, msg: string) =>
        calls.push({
          level: 'info',
          obj: { ...contextChain, ...bindings, ...obj },
          msg,
        });
      fake.instance.warn = (obj: Record<string, unknown>, msg: string) =>
        calls.push({
          level: 'warn',
          obj: { ...contextChain, ...bindings, ...obj },
          msg,
        });
      fake.instance.error = (obj: Record<string, unknown>, msg: string) =>
        calls.push({
          level: 'error',
          obj: { ...contextChain, ...bindings, ...obj },
          msg,
        });
      return fake.instance;
    },
  };
  return { calls, instance };
}

describe('createPinoLogger', () => {
  it('forwards info with (context, message) argument order', () => {
    const fake = createFakePino();
    const logger = createPinoLogger(fake.instance);
    logger.info('hello', { user: 'x' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.level).toBe('info');
    expect(fake.calls[0]!.msg).toBe('hello');
    expect(fake.calls[0]!.obj['user']).toBe('x');
  });

  it('forwards debug/warn/error', () => {
    const fake = createFakePino();
    const logger = createPinoLogger(fake.instance);
    logger.debug('d');
    logger.warn('w');
    logger.error('e', { k: 1 });
    expect(fake.calls.map((c) => c.level)).toEqual(['debug', 'warn', 'error']);
    expect(fake.calls[2]!.obj['k']).toBe(1);
  });

  it('child() delegates to the underlying pino.child with bindings', () => {
    const fake = createFakePino();
    const logger = createPinoLogger(fake.instance);
    const child = logger.child({ request_id: 'r1' });
    child.info('hit');
    expect(fake.calls[0]!.obj['request_id']).toBe('r1');
    expect(fake.calls[0]!.msg).toBe('hit');
  });

  it('handles missing context parameter', () => {
    const fake = createFakePino();
    const logger = createPinoLogger(fake.instance);
    logger.info('no-ctx');
    expect(fake.calls[0]!.msg).toBe('no-ctx');
    expect(fake.calls[0]!.obj).toEqual({});
  });

  it('throws if the instance does not look like pino', () => {
    expect(() => createPinoLogger({} as unknown)).toThrow(
      /pino/i,
    );
    expect(() => createPinoLogger(null as unknown)).toThrow(/pino/i);
  });
});
