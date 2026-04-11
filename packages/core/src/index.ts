/**
 * @triad/core — public API.
 *
 * Phase 1: schema DSL (`t.*`).
 * Phase 2: endpoint / behavior / router.
 */

// --- Schema DSL ------------------------------------------------------------

export { t, isEmptySchema } from './schema/index.js';
export {
  StringSchema,
  NumberSchema,
  BooleanSchema,
  DateTimeSchema,
  EnumSchema,
  LiteralSchema,
  UnknownSchema,
  EmptySchema,
  ArraySchema,
  RecordSchema,
  TupleSchema,
  UnionSchema,
  ModelSchema,
  ValueSchema,
} from './schema/index.js';

export {
  SchemaNode,
  ValidationException,
  createOpenAPIContext,
  joinPath,
  type SchemaMetadata,
  type StorageMetadata,
  type ValidationError,
  type ValidationResult,
  type OpenAPISchema,
  type OpenAPIContext,
  type Infer,
} from './schema/types.js';

export type { StringFormat } from './schema/string.js';
export type { NumberType } from './schema/number.js';
export type { ModelShape, InferShape } from './schema/model.js';

// --- Behavior --------------------------------------------------------------

export {
  scenario,
  parseAssertion,
  hasStatusAssertion,
  type Behavior,
  type ChainableBehavior,
  type GivenData,
  type WhenData,
  type Assertion,
  type ScenarioStage,
} from './behavior.js';

// --- Context ---------------------------------------------------------------

export {
  buildRespondMap,
  type ServiceContainer,
  type ResponseConfig,
  type ResponsesConfig,
  type HandlerResponse,
  type HandlerContext,
  type RespondFn,
  type RespondMap,
  type InferRequestPart,
  type InferBody,
} from './context.js';

// --- Endpoint --------------------------------------------------------------

export {
  endpoint,
  type Endpoint,
  type EndpointConfig,
  type RequestConfig,
  type NormalizedRequest,
  type HttpMethod,
} from './endpoint.js';

// --- BeforeHandler ---------------------------------------------------------

export {
  invokeBeforeHandler,
  type BeforeHandler,
  type BeforeHandlerContext,
  type BeforeHandlerResult,
  type BeforeHandlerSuccess,
  type BeforeHandlerShortCircuit,
} from './before-handler.js';

// --- Ownership helper ------------------------------------------------------

export {
  checkOwnership,
  type OwnershipResult,
} from './ownership.js';

// --- Router ----------------------------------------------------------------

export {
  createRouter,
  Router,
  type RouterConfig,
  type ServerConfig,
  type BoundedContext,
  type BoundedContextConfig,
  type ContextBuilder,
  type RoutableItem,
} from './router.js';

// --- Channels (WebSocket) --------------------------------------------------

export {
  channel,
  isChannel,
  type Channel,
  type ChannelConfig,
  type ChannelConnectionConfig,
} from './channel.js';

export type {
  ChannelConnectContext,
  ChannelMessageContext,
  ChannelMessages,
  ChannelMessageConfig,
  BroadcastMap,
  SendMap,
  DefaultChannelState,
  ChannelReject,
} from './channel-context.js';
