/**
 * @triadjs/core — public API.
 *
 * Phase 1: schema DSL (`t.*`).
 * Phase 2: endpoint / behavior / router.
 */

// --- Schema DSL ------------------------------------------------------------

export {
  t,
  isEmptySchema,
  isFileSchema,
  hasFileFields,
  type TriadFile,
  type FileConstraints,
} from './schema/index.js';
export {
  StringSchema,
  NumberSchema,
  BooleanSchema,
  DateTimeSchema,
  EnumSchema,
  LiteralSchema,
  UnknownSchema,
  EmptySchema,
  FileSchema,
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
  type AndWhenStage,
} from './behavior.js';

// --- Context ---------------------------------------------------------------

export {
  buildRespondMap,
  type ServiceContainer,
  type ResponseConfig,
  type ResponsesConfig,
  type HandlerResponse,
  type ResponseOptions,
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

// --- Scenario Auto ---------------------------------------------------------

export {
  auto as scenarioAuto,
  isAutoScenarioMarker,
  type ScenarioAutoOptions,
  type AutoScenarioMarker,
} from './scenario-auto.js';

// Attach `auto` as a property on the `scenario` function so users can write
// `...scenario.auto()` without a separate import.
import { auto as _autoFn } from './scenario-auto.js';
import { scenario as _scenario } from './behavior.js';
(_scenario as unknown as Record<string, unknown>)['auto'] = _autoFn;

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
  ChannelBeforeHandler,
  ChannelBeforeHandlerContext,
  ChannelBeforeHandlerResult,
  ChannelBeforeHandlerSuccess,
  ChannelBeforeHandlerRejection,
} from './channel-context.js';
