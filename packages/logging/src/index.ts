/**
 * @triad/logging — structured logging instrumentation for Triad routers.
 *
 * Opt-in router wrapper that attaches a request-scoped child logger
 * (endpoint name, bounded context, user id, request id) to every log
 * call inside a handler. Ships logger-agnostic: bring pino, winston, or
 * the built-in console adapter.
 */

export {
  type Logger,
  type LogLevel,
  type ConsoleLoggerOptions,
  createConsoleLogger,
  createPinoLogger,
  createWinstonLogger,
} from './logger.js';

export {
  withLoggingInstrumentation,
  getLogger,
  tryGetLogger,
  type LoggingInstrumentationOptions,
} from './wrap-router.js';

export { requestIdFromHeader } from './helpers.js';
