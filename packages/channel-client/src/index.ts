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
export {
  toPascalCase,
  toCamelCase,
  toKebabCase,
  messageToHandlerName,
  collectTypeRefs,
  walkInlineShape,
  analyzeChannel,
  TYPE_REF_RE,
  BUILTIN,
} from './hook-analysis.js';
export type {
  MsgRef,
  ChannelHookAnalysis,
} from './hook-analysis.js';
