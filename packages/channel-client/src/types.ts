/**
 * Public types for `@triad/channel-client`.
 *
 * The generator is a pure function: it takes a Triad `Router` and a
 * small options bag and returns a list of `GeneratedFile`s. The CLI
 * or a build script writes them to disk.
 */

export interface GenerateChannelClientOptions {
  /**
   * Directory the files will eventually be written into. The
   * generator does not actually write — it just uses this for
   * bookkeeping and for any path-relative logic downstream.
   */
  outputDir: string;
  /**
   * Default base URL embedded in the generated runtime client. At
   * runtime, users can still override this per-instance by passing
   * `{ url }` to the channel client constructor.
   */
  baseUrl?: string;
  /**
   * Whether to emit the runtime `client.ts` file. Set to `false`
   * when you have your own vanilla WebSocket wrapper and only want
   * the typed per-channel factories.
   */
  emitRuntime?: boolean;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}
