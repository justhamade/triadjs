/**
 * @triadjs/asyncapi — generate AsyncAPI 3.0 documents from a Triad router.
 *
 * ```ts
 * import { createRouter, channel } from '@triadjs/core';
 * import { generateAsyncAPI, toYaml } from '@triadjs/asyncapi';
 *
 * const router = createRouter({ title: 'Realtime API', version: '1.0.0' });
 * router.add(chatRoom);
 *
 * const doc = generateAsyncAPI(router);
 * console.log(toYaml(doc));
 * ```
 */

export {
  generateAsyncAPI,
  convertPath,
  type GenerateOptions,
  type AsyncAPIDocument,
  type AsyncAPIInfo,
  type AsyncAPIServer,
  type AsyncAPITag,
  type AsyncAPIChannelObject,
  type AsyncAPIParameter,
  type AsyncAPIMessageRef,
  type AsyncAPIChannelBindings,
  type AsyncAPIWebSocketBinding,
  type AsyncAPIOperation,
  type AsyncAPIMessage,
} from './generator.js';

export { toYaml, toJson } from './serialize.js';
