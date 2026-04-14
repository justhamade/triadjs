/**
 * `Logger` — the tiny, logger-agnostic interface at the heart of
 * `@triadjs/logging`. Users bring their own logger (pino, winston, or the
 * built-in console adapter) and the wrapper attaches request-scoped
 * context via `child()`.
 *
 * The interface is intentionally minimal: four levels, a context bag,
 * and `child()`. Any sane logger can implement it in a few lines.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** Return a new logger with `context` merged into every subsequent call. */
  child(context: Record<string, unknown>): Logger;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// ---------------------------------------------------------------------------
// Console adapter — JSON-per-line or pretty printed
// ---------------------------------------------------------------------------

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
}

type ConsoleSink = {
  debug: (line: string) => void;
  info: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
};

class ConsoleLogger implements Logger {
  private readonly minLevel: number;
  private readonly pretty: boolean;
  private readonly contextChain: Record<string, unknown>;
  private readonly sink: ConsoleSink;

  constructor(
    options: ConsoleLoggerOptions,
    contextChain: Record<string, unknown>,
  ) {
    this.minLevel = LEVEL_ORDER[options.level ?? 'info'];
    this.pretty = options.pretty ?? false;
    this.contextChain = contextChain;
    this.sink = {
      debug: (line) => console.debug(line),
      info: (line) => console.info(line),
      warn: (line) => console.warn(line),
      error: (line) => console.error(line),
    };
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const merged = { ...this.contextChain, ...(context ?? {}) };
    const line = this.pretty
      ? formatPretty(level, message, merged)
      : formatJson(level, message, merged);
    this.sink[level](line);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }
  child(context: Record<string, unknown>): Logger {
    return new ConsoleLogger(
      {
        level: levelFromOrder(this.minLevel),
        pretty: this.pretty,
      },
      { ...this.contextChain, ...context },
    );
  }
}

function levelFromOrder(order: number): LogLevel {
  if (order <= LEVEL_ORDER.debug) return 'debug';
  if (order <= LEVEL_ORDER.info) return 'info';
  if (order <= LEVEL_ORDER.warn) return 'warn';
  return 'error';
}

function formatJson(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
): string {
  return JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  });
}

function formatPretty(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
): string {
  const time = new Date().toISOString();
  const pairs = Object.entries(context)
    .map(([k, v]) => `${k}=${stringifyValue(v)}`)
    .join(' ');
  return `${time} ${level.toUpperCase()} ${message}${pairs ? ' ' + pairs : ''}`;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  return new ConsoleLogger(options, {});
}

// ---------------------------------------------------------------------------
// Pino adapter — duck-typed against the public pino Logger interface.
//
// Pino convention: `logger.info(obj, msg)`. We forward `(message, context)`
// as `(context ?? {}, message)`. `child()` is `pino.child(bindings)`.
//
// The narrow `any` interop lives in exactly one place: the `PinoLike` shape
// below. We assert the instance matches this shape at construction time.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

type PinoLike = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLike;
};

function isPinoLike(value: unknown): value is PinoLike {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['debug'] === 'function' &&
    typeof v['info'] === 'function' &&
    typeof v['warn'] === 'function' &&
    typeof v['error'] === 'function' &&
    typeof v['child'] === 'function'
  );
}

class PinoLoggerAdapter implements Logger {
  constructor(private readonly instance: PinoLike) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.instance.debug(context ?? {}, message);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.instance.info(context ?? {}, message);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.instance.warn(context ?? {}, message);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.instance.error(context ?? {}, message);
  }
  child(context: Record<string, unknown>): Logger {
    return new PinoLoggerAdapter(this.instance.child(context));
  }
}

/**
 * Wrap a user-constructed pino logger as a Triad `Logger`.
 *
 * The wrapper duck-types the instance: it must expose `debug`, `info`,
 * `warn`, `error`, and `child` methods. The pino `info(obj, msg)` arg
 * order is preserved on forwarding.
 */
export function createPinoLogger(pinoInstance: unknown): Logger {
  if (!isPinoLike(pinoInstance)) {
    throw new Error(
      'createPinoLogger: expected a pino logger instance with debug/info/warn/error/child methods',
    );
  }
  return new PinoLoggerAdapter(pinoInstance);
}

// ---------------------------------------------------------------------------
// Winston adapter — duck-typed against the public winston Logger interface.
//
// Winston convention: `logger.info(msg, meta)`. We forward `(message,
// context)` as `(message, context ?? {})`. `child()` is `winston.child(opts)`.
// ---------------------------------------------------------------------------

type WinstonLike = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child: (opts: Record<string, unknown>) => WinstonLike;
};

function isWinstonLike(value: unknown): value is WinstonLike {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['debug'] === 'function' &&
    typeof v['info'] === 'function' &&
    typeof v['warn'] === 'function' &&
    typeof v['error'] === 'function' &&
    typeof v['child'] === 'function'
  );
}

class WinstonLoggerAdapter implements Logger {
  constructor(private readonly instance: WinstonLike) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.instance.debug(message, context ?? {});
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.instance.info(message, context ?? {});
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.instance.warn(message, context ?? {});
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.instance.error(message, context ?? {});
  }
  child(context: Record<string, unknown>): Logger {
    return new WinstonLoggerAdapter(this.instance.child(context));
  }
}

/**
 * Wrap a user-constructed winston logger as a Triad `Logger`.
 *
 * Duck-types the instance and preserves winston's `info(msg, meta)` arg
 * order on forwarding.
 */
export function createWinstonLogger(winstonInstance: unknown): Logger {
  if (!isWinstonLike(winstonInstance)) {
    throw new Error(
      'createWinstonLogger: expected a winston logger instance with debug/info/warn/error/child methods',
    );
  }
  return new WinstonLoggerAdapter(winstonInstance);
}

/* eslint-enable @typescript-eslint/no-explicit-any */
