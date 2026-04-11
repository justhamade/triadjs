/**
 * Public configuration types for the Forms generator.
 */

export interface GenerateOptions {
  /** Output directory for generated files. */
  outputDir: string;
  /** Whether to emit resolver wrappers for `react-hook-form` (default: false). */
  reactHookForm?: boolean;
  /** Whether to emit validator wrappers for `@tanstack/form` (default: false). */
  tanstackForm?: boolean;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}
