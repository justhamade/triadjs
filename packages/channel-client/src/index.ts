/**
 * `@triad/channel-client` — generate typed vanilla TypeScript
 * WebSocket clients from Triad `channel()` declarations.
 */

export { generateChannelClient } from './generator.js';
export { writeFiles } from './write.js';
export { emitChannelClient } from './channel-generator.js';
export { renderClientRuntime } from './client-template.js';
export type {
  GenerateChannelClientOptions,
  GeneratedFile,
} from './types.js';
