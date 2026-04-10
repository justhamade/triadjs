/**
 * @triad/openapi — generate OpenAPI 3.1 documents from a Triad router.
 *
 * ```ts
 * import { createRouter } from '@triad/core';
 * import { generateOpenAPI, toYaml } from '@triad/openapi';
 *
 * const router = createRouter({ title: 'API', version: '1.0.0' });
 * router.add(createPet, getPet);
 *
 * const doc = generateOpenAPI(router);
 * console.log(toYaml(doc));
 * ```
 */

export {
  generateOpenAPI,
  convertPath,
  type GenerateOptions,
  type OpenAPIDocument,
  type OpenAPIInfo,
  type OpenAPIServer,
  type OpenAPITag,
  type PathItem,
  type Operation,
  type Parameter,
  type RequestBody,
  type Response,
  type MediaType,
} from './generator.js';

export { toYaml, toJson } from './serialize.js';
