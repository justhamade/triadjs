/**
 * @triadjs/lambda — run a Triad router as an AWS Lambda handler.
 *
 * ```ts
 * import { createLambdaHandler } from '@triadjs/lambda';
 * import router from './app.js';
 * import { createServices } from './services.js';
 *
 * export const handler = createLambdaHandler(router, {
 *   services: (event) => createServices({
 *     tenant: event.headers?.['x-tenant'] ?? 'default',
 *   }),
 * });
 * ```
 *
 * Supports API Gateway v1 (REST API), API Gateway v2 (HTTP API),
 * Lambda Function URLs, and ALB target invocations. Error envelopes
 * match `@triadjs/express`, `@triadjs/fastify`, and `@triadjs/hono`
 * byte-for-byte. WebSocket channels are not supported — Lambda is
 * request/response only.
 */

export {
  createLambdaHandler,
  type CreateLambdaHandlerOptions,
  type ServicesResolver,
  type LambdaHandler,
} from './handler.js';

export {
  type LambdaEvent,
  type LambdaResult,
  type LambdaContext,
  type APIGatewayProxyEventV1,
  type APIGatewayProxyEventV2,
  type APIGatewayProxyResultV1,
  type APIGatewayProxyResultV2,
} from './aws-types.js';

export { RequestValidationError, type RequestPart } from './errors.js';

export { coerceScalar, coerceByShape } from './coerce.js';

export {
  compilePattern,
  matchPattern,
  type CompiledPattern,
  type MatchResult,
} from './path-matcher.js';
