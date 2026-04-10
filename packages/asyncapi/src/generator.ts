/**
 * AsyncAPI 3.0 document generator.
 *
 * Walks a Triad `Router` and produces a complete AsyncAPI 3.0 document
 * from its WebSocket channels — the real-time counterpart to what
 * `@triad/openapi` produces for HTTP endpoints:
 *
 *   - Channels → `channels[<channelName>]` with converted `{param}`
 *     address, `parameters`, and optional WebSocket `bindings`
 *   - Client messages → `operations[<op>]` with `action: 'send'`
 *   - Server messages → `operations[<op>]` with `action: 'receive'`
 *   - Named payload models → `components/schemas` with `$ref` (reusing
 *     the exact same `OpenAPIContext` + `toOpenAPI()` machinery the
 *     OpenAPI generator uses, so a `ChatMessage` declared once shows up
 *     identically in both docs)
 *   - Per-message wrapper objects → `components/messages`
 *   - Bounded contexts → top-level `tags[]` with descriptions; channels
 *     inside a context are auto-tagged with the context name
 *
 * The generator is pure: it takes a Router and returns a plain JS
 * object. Serialization (YAML/JSON) lives in a sibling module.
 *
 * Why the operation `action` is "send" for clientMessages and
 * "receive" for serverMessages: AsyncAPI 3.0 models operations from
 * the application's point of view. The application (the Triad server)
 * *receives* a client message and *sends* a server message. That
 * reverses the naming compared to the Triad `channel()` DSL, which
 * names them from the perspective of who authored the message. This
 * is unavoidable — it's how AsyncAPI 3.0 is defined.
 *
 * Why operationIds use `${channelName}.${messageType}` without a
 * `send.`/`recv.` prefix: AsyncAPI 3.0 operations are disambiguated
 * structurally by their `action` field, so the extra prefix would be
 * redundant in the generated document. Using the same
 * `channel.message` shape on both sides also makes it trivial for
 * tooling to find "the operation for client message X" without
 * worrying about direction first.
 */

import {
  type Router,
  type Channel,
  type ChannelMessageConfig,
  type OpenAPISchema,
  type OpenAPIContext,
  type ModelShape,
  type SchemaNode,
  createOpenAPIContext,
} from '@triad/core';

// ---------------------------------------------------------------------------
// AsyncAPI 3.0 document types (the subset Triad produces)
// ---------------------------------------------------------------------------

export interface AsyncAPIDocument {
  asyncapi: '3.0.0';
  info: AsyncAPIInfo;
  servers?: Record<string, AsyncAPIServer>;
  channels: Record<string, AsyncAPIChannelObject>;
  operations: Record<string, AsyncAPIOperation>;
  components: {
    schemas: Record<string, OpenAPISchema>;
    messages: Record<string, AsyncAPIMessage>;
  };
  tags?: AsyncAPITag[];
}

export interface AsyncAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface AsyncAPIServer {
  host: string;
  protocol: string;
  description?: string;
}

export interface AsyncAPITag {
  name: string;
  description?: string;
}

export interface AsyncAPIChannelObject {
  address: string;
  title?: string;
  summary?: string;
  description?: string;
  parameters?: Record<string, AsyncAPIParameter>;
  messages: Record<string, AsyncAPIMessageRef>;
  bindings?: AsyncAPIChannelBindings;
  tags?: AsyncAPITag[];
}

/**
 * AsyncAPI 3.0 parameter object. Parameters are always string-valued in
 * 3.0 — there is no nested JSON Schema, unlike OpenAPI parameters.
 */
export interface AsyncAPIParameter {
  description?: string;
  enum?: string[];
  default?: string;
  examples?: string[];
  location?: string;
}

export interface AsyncAPIMessageRef {
  $ref: string;
}

/**
 * Channel-level bindings. Triad only emits WebSocket bindings today.
 * Headers and query strings live on the handshake (not on individual
 * messages), so both end up under `channel.bindings.ws` as JSON Schemas.
 */
export interface AsyncAPIChannelBindings {
  ws?: AsyncAPIWebSocketBinding;
}

export interface AsyncAPIWebSocketBinding {
  method?: 'GET' | 'POST';
  query?: OpenAPISchema;
  headers?: OpenAPISchema;
  bindingVersion?: string;
}

export interface AsyncAPIOperation {
  action: 'send' | 'receive';
  channel: { $ref: string };
  summary?: string;
  description?: string;
  tags?: AsyncAPITag[];
  messages: Array<{ $ref: string }>;
}

export interface AsyncAPIMessage {
  name: string;
  title?: string;
  summary?: string;
  description?: string;
  payload: OpenAPISchema | { $ref: string };
  contentType?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Reserved for future options; currently unused. */
  readonly _reserved?: never;
}

/**
 * Generate an AsyncAPI 3.0 document from a Triad router.
 *
 * Every channel registered on the router — whether added directly via
 * `router.add(...)` or inside a bounded context — becomes a channel in
 * the output. Channels with no messages are still emitted (the
 * resulting document is legal AsyncAPI 3.0) so tooling can introspect
 * the connection surface even when handlers haven't been declared yet.
 */
export function generateAsyncAPI(
  router: Router,
  _options: GenerateOptions = {},
): AsyncAPIDocument {
  const ctx = createOpenAPIContext();
  const channels: Record<string, AsyncAPIChannelObject> = {};
  const operations: Record<string, AsyncAPIOperation> = {};
  const messages: Record<string, AsyncAPIMessage> = {};
  const tags = collectTags(router);

  for (const channel of router.allChannels()) {
    const channelName = channel.name;
    const channelTags = resolveChannelTags(channel, router);

    // Parameters and bindings are derived from the handshake config
    // (`channel.connection.*`). We register these schemas against the
    // same shared `ctx` so any named models declared on headers/query
    // land in `components.schemas` alongside the payload schemas.
    const parameters = buildParameters(channel);
    const bindings = buildBindings(channel, ctx);

    const channelObject: AsyncAPIChannelObject = {
      address: convertPath(channel.path),
      title: channelName,
      summary: channel.summary,
      messages: {},
    };
    if (channel.description !== undefined) {
      channelObject.description = channel.description;
    }
    if (parameters) channelObject.parameters = parameters;
    if (bindings) channelObject.bindings = bindings;
    if (channelTags.length > 0) {
      channelObject.tags = channelTags.map((name) => ({ name }));
    }

    // Register every message (client + server) in `components.messages`
    // and wire up a per-channel `messages` map of `$ref`s. Operations
    // point at the channel-local ref, not the component ref — that's
    // the AsyncAPI 3.0 convention.
    //
    // Message keys are namespaced by direction (`client`/`server`) in
    // addition to channel + type. This is necessary because the same
    // message name can appear in BOTH directions with different
    // schemas — e.g. a chat channel declaring `typing` as a client
    // payload (just `{isTyping}`) and as a server broadcast
    // (`{userId, isTyping}`). Without the direction bucket, one would
    // silently overwrite the other.
    registerMessages(
      channel,
      channel.clientMessages,
      'client',
      messages,
      channelObject,
      ctx,
    );
    registerMessages(
      channel,
      channel.serverMessages,
      'server',
      messages,
      channelObject,
      ctx,
    );

    channels[channelName] = channelObject;

    // Emit one operation per declared message. clientMessages become
    // `receive` (the server receives them); serverMessages become
    // `send` (the server sends them). See header comment for rationale.
    // Operation IDs also include the direction bucket to avoid the
    // same collision risk described above.
    for (const messageType of Object.keys(channel.clientMessages)) {
      const opId = operationId(channelName, 'client', messageType);
      operations[opId] = buildOperation({
        action: 'receive',
        channelName,
        direction: 'client',
        messageType,
        description: channel.clientMessages[messageType]!.description,
        tags: channelTags,
        channel,
      });
    }
    for (const messageType of Object.keys(channel.serverMessages)) {
      const opId = operationId(channelName, 'server', messageType);
      operations[opId] = buildOperation({
        action: 'send',
        channelName,
        direction: 'server',
        messageType,
        description: channel.serverMessages[messageType]!.description,
        tags: channelTags,
        channel,
      });
    }

    // Propagate any channel-level tags to the top-level tag list so
    // tooling can render a unified tag sidebar.
    for (const tagName of channelTags) {
      if (!tags.find((t) => t.name === tagName)) {
        tags.push({ name: tagName });
      }
    }
  }

  const doc: AsyncAPIDocument = {
    asyncapi: '3.0.0',
    info: buildInfo(router),
    channels,
    operations,
    components: {
      schemas: Object.fromEntries(ctx.components),
      messages,
    },
  };

  const servers = buildServers(router);
  if (servers) doc.servers = servers;

  if (tags.length > 0) {
    doc.tags = tags;
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInfo(router: Router): AsyncAPIInfo {
  const info: AsyncAPIInfo = {
    title: router.config.title,
    version: router.config.version,
  };
  if (router.config.description !== undefined) {
    info.description = router.config.description;
  }
  return info;
}

/**
 * AsyncAPI 3.0 servers are a map keyed by server name, each with a
 * `host` + `protocol`. Triad's `ServerConfig` uses a single `url`
 * field, so we naively parse `ws(s)?://host/...` out of it. When a
 * URL doesn't parse we fall back to an HTTP protocol — good enough for
 * docs and consistent with how other AsyncAPI tooling handles mixed
 * HTTP/WS server lists.
 */
function buildServers(
  router: Router,
): Record<string, AsyncAPIServer> | undefined {
  const servers = router.config.servers;
  if (!servers || servers.length === 0) return undefined;
  const out: Record<string, AsyncAPIServer> = {};
  servers.forEach((server, index) => {
    const key = server.description
      ? slugify(server.description)
      : `server${index}`;
    const parsed = parseServerUrl(server.url);
    const entry: AsyncAPIServer = {
      host: parsed.host,
      protocol: parsed.protocol,
    };
    if (server.description !== undefined) {
      entry.description = server.description;
    }
    out[key] = entry;
  });
  return out;
}

function parseServerUrl(url: string): { host: string; protocol: string } {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)/i.exec(url);
  if (match) {
    return { protocol: match[1]!.toLowerCase(), host: match[2]! };
  }
  return { protocol: 'https', host: url };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Bounded contexts provide documented tags with descriptions. */
function collectTags(router: Router): AsyncAPITag[] {
  const tags: AsyncAPITag[] = [];
  for (const context of router.contexts) {
    // Only emit a tag for contexts that actually own at least one
    // channel; otherwise the tag is noise in the AsyncAPI output (the
    // OpenAPI generator already covers HTTP-only contexts).
    if (context.channels.length === 0) continue;
    const tag: AsyncAPITag = { name: context.name };
    if (context.description !== undefined) {
      tag.description = context.description;
    }
    tags.push(tag);
  }
  return tags;
}

/**
 * Tags for a given channel: the explicit `channel.tags` plus an
 * auto-tag for the bounded context the channel belongs to, if any.
 * Deduplicated while preserving declaration order.
 */
function resolveChannelTags(channel: Channel, router: Router): string[] {
  const tags = [...channel.tags];
  const context = router.contextOf(channel);
  if (context && !tags.includes(context.name)) {
    tags.push(context.name);
  }
  return tags;
}

/** Fastify-style `:id` → AsyncAPI `{id}`. Same algorithm as `@triad/openapi`. */
export function convertPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * AsyncAPI 3.0 operationIds are
 * `<channelName>.<direction>.<messageType>` where `direction` is
 * `client` (for messages the client sends to the server) or `server`
 * (for messages the server broadcasts to clients).
 *
 * The direction bucket is necessary because Triad channels can declare
 * the same message name in both directions with different schemas
 * (the canonical example is a chat channel's `typing`, which appears
 * as a client input and as a server broadcast with different payload
 * shapes). Without the direction in the key, the second entry would
 * silently overwrite the first in the `operations` map.
 */
function operationId(
  channelName: string,
  direction: 'client' | 'server',
  messageType: string,
): string {
  return `${channelName}.${direction}.${messageType}`;
}

/**
 * Build the `parameters` map for a channel. AsyncAPI 3.0 parameters
 * are simple string-valued descriptors — there's no nested JSON
 * Schema. For enum fields we lift the values onto the parameter's
 * `enum`; for others we just surface the description and any default.
 */
function buildParameters(
  channel: Channel,
): Record<string, AsyncAPIParameter> | undefined {
  const paramsModel = channel.connection.params;
  if (!paramsModel) return undefined;
  const out: Record<string, AsyncAPIParameter> = {};
  const shape = paramsModel.shape as ModelShape;
  for (const [name, schema] of Object.entries(shape)) {
    out[name] = buildParameter(schema);
  }
  return out;
}

function buildParameter(schema: SchemaNode): AsyncAPIParameter {
  const param: AsyncAPIParameter = {};
  if (schema.metadata.description !== undefined) {
    param.description = schema.metadata.description;
  }
  // Structural `kind` check rather than `instanceof` — the channel
  // graph may cross module boundaries when the CLI loads a router via
  // jiti while the generator runs under the bundler's copy of core.
  if ((schema as { kind?: string }).kind === 'enum') {
    const enumSchema = schema as unknown as { values: readonly string[] };
    param.enum = [...enumSchema.values];
  }
  if (schema.metadata.default !== undefined) {
    param.default = String(schema.metadata.default);
  }
  return param;
}

/**
 * Build the `bindings` object for a channel. Headers and query strings
 * declared on `channel.connection` land on the WebSocket binding as
 * JSON Schemas — reusing the exact same `toOpenAPI()` emission the
 * HTTP generator uses so named models `$ref` into `components/schemas`.
 */
function buildBindings(
  channel: Channel,
  ctx: OpenAPIContext,
): AsyncAPIChannelBindings | undefined {
  const headersModel = channel.connection.headers;
  const queryModel = channel.connection.query;
  if (!headersModel && !queryModel) return undefined;

  // We want inline object schemas here, not `$ref`s into
  // `components.schemas` — the anonymous `${name}Headers` / `${name}Query`
  // models would otherwise leak as named components in the AsyncAPI
  // output. `_buildInlineSchema()` emits the object body directly while
  // still registering any *nested* named models it encounters against
  // the shared context.
  const ws: AsyncAPIWebSocketBinding = { bindingVersion: '0.1.0' };
  if (headersModel) ws.headers = headersModel._buildInlineSchema(ctx);
  if (queryModel) ws.query = queryModel._buildInlineSchema(ctx);
  return { ws };
}

/**
 * Register a map of messages (either `clientMessages` or
 * `serverMessages`) in both `components.messages` and the given
 * channel object's local `messages` map.
 *
 * Component message names are namespaced by channel to keep messages
 * belonging to different channels from colliding when two channels
 * happen to declare the same message type (e.g. `error`).
 */
function registerMessages(
  channel: Channel,
  messages: Record<string, ChannelMessageConfig>,
  direction: 'client' | 'server',
  componentMessages: Record<string, AsyncAPIMessage>,
  channelObject: AsyncAPIChannelObject,
  ctx: OpenAPIContext,
): void {
  for (const [messageType, config] of Object.entries(messages)) {
    // Component key is namespaced by channel + direction + type so
    // collisions across channels AND across directions inside one
    // channel are both impossible.
    const componentKey = `${channel.name}.${direction}.${messageType}`;
    if (!(componentKey in componentMessages)) {
      componentMessages[componentKey] = buildMessage(messageType, config, ctx);
    }
    // Channel-local map uses a direction-suffixed key so the two
    // buckets don't collide here either. The channel-local key is
    // `<messageType>` for single-direction types and
    // `<messageType>_<direction>` when the same name appears in both
    // directions; for simplicity we always suffix with direction on
    // the conflict-prone side (`server` stays bare when possible,
    // `client` gets the suffix when there's overlap).
    const localKey = chooseLocalMessageKey(
      channelObject,
      messageType,
      direction,
    );
    channelObject.messages[localKey] = {
      $ref: `#/components/messages/${componentKey}`,
    };
  }
}

/**
 * Decide the key to use in the per-channel `messages` map. We prefer
 * the bare message type — it's what AsyncAPI tooling displays. If the
 * type is already claimed by a different direction, append
 * `_${direction}` to disambiguate.
 */
function chooseLocalMessageKey(
  channelObject: AsyncAPIChannelObject,
  messageType: string,
  direction: 'client' | 'server',
): string {
  if (!(messageType in channelObject.messages)) return messageType;
  return `${messageType}_${direction}`;
}

function buildMessage(
  messageType: string,
  config: ChannelMessageConfig,
  ctx: OpenAPIContext,
): AsyncAPIMessage {
  const payload = config.schema.toOpenAPI(ctx);
  const message: AsyncAPIMessage = {
    name: messageType,
    title: messageType,
    contentType: 'application/json',
    payload,
  };
  if (config.description !== undefined && config.description !== '') {
    message.summary = config.description;
  }
  return message;
}

/**
 * Compute the channel-local message key given the direction and the
 * other direction's message set. Rule: `client` direction always wins
 * the bare name (it's registered first). `server` direction gets the
 * bare name only when the clientMessages don't also declare it; when
 * they do, server is suffixed with `_server`.
 */
function resolveLocalMessageKey(
  messageType: string,
  direction: 'client' | 'server',
  channel: Channel,
): string {
  if (direction === 'client') return messageType;
  // direction === 'server'
  if (messageType in channel.clientMessages) {
    return `${messageType}_server`;
  }
  return messageType;
}

function buildOperation(args: {
  action: 'send' | 'receive';
  channelName: string;
  direction: 'client' | 'server';
  messageType: string;
  description: string;
  tags: readonly string[];
  channel: Channel;
}): AsyncAPIOperation {
  const localKey = resolveLocalMessageKey(
    args.messageType,
    args.direction,
    args.channel,
  );
  const op: AsyncAPIOperation = {
    action: args.action,
    channel: { $ref: `#/channels/${args.channelName}` },
    messages: [
      {
        $ref: `#/channels/${args.channelName}/messages/${localKey}`,
      },
    ],
  };
  if (args.description !== '') {
    op.summary = args.description;
  }
  if (args.tags.length > 0) {
    op.tags = args.tags.map((name) => ({ name }));
  }
  return op;
}
