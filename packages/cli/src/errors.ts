/**
 * CLI error taxonomy.
 *
 * Every user-facing failure throws a `CliError` with a stable code and an
 * exit code. The top-level dispatcher catches these and prints a clean
 * message without a stack trace (unlike unexpected errors, which are
 * printed with full stack traces for debugging).
 */

export type CliErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'NO_ROUTER'
  | 'ROUTER_NOT_FOUND'
  | 'INVALID_ROUTER'
  | 'SETUP_NOT_FOUND'
  | 'SETUP_INVALID'
  | 'VALIDATION_FAILED'
  | 'TESTS_FAILED'
  | 'OUTPUT_WRITE_FAILED';

const DEFAULT_EXIT_CODE: Record<CliErrorCode, number> = {
  CONFIG_NOT_FOUND: 2,
  CONFIG_INVALID: 2,
  NO_ROUTER: 2,
  ROUTER_NOT_FOUND: 2,
  INVALID_ROUTER: 2,
  SETUP_NOT_FOUND: 2,
  SETUP_INVALID: 2,
  VALIDATION_FAILED: 1,
  TESTS_FAILED: 1,
  OUTPUT_WRITE_FAILED: 2,
};

export class CliError extends Error {
  public readonly exitCode: number;

  constructor(
    message: string,
    public readonly code: CliErrorCode,
    exitCode?: number,
  ) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode ?? DEFAULT_EXIT_CODE[code];
  }
}
