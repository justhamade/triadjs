/**
 * Public types for `@triad/channel-client`.
 *
 * The generator is a pure function: it takes a Triad `Router` and a
 * small options bag and returns a list of `GeneratedFile`s. The CLI
 * or a build script writes them to disk.
 */

/**
 * Codegen targets supported by `generateChannelClient`.
 *
 *   - `'channel-client'`        — vanilla TypeScript WebSocket clients
 *   - `'channel-client-react'`  — vanilla clients + React hook wrapper
 *                                 per channel (a superset)
 *   - `'channel-client-solid'`  — vanilla clients + Solid signal-based
 *                                 wrapper per channel (a superset)
 *   - `'channel-client-vue'`    — vanilla clients + Vue Composition API
 *                                 wrapper per channel (a superset)
 *   - `'channel-client-svelte'` — vanilla clients + Svelte store-based
 *                                 wrapper per channel (a superset)
 *
 * When multiple targets are passed, the generator dedupes: the vanilla
 * files are only emitted once regardless of how many framework
 * targets are combined.
 */
export type ChannelClientTarget =
  | 'channel-client'
  | 'channel-client-react'
  | 'channel-client-solid'
  | 'channel-client-vue'
  | 'channel-client-svelte';

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
  /**
   * Which target(s) to emit. Defaults to `'channel-client'` (vanilla
   * only). Pass `'channel-client-react'` to additionally emit React
   * hook wrappers; the vanilla files are always emitted because the
   * React hooks import them.
   */
  target?: ChannelClientTarget | readonly ChannelClientTarget[];
}

export interface GeneratedFile {
  path: string;
  contents: string;
}
