/**
 * In-memory multi-client simulator for Triad channels.
 *
 * This is the test-only analog of Phase 9.2's `ChannelHub` in the
 * Fastify adapter. It implements the same three invariants so test
 * scenarios see the same semantics the real WebSocket adapter does:
 *
 *   1. **Grouping by resolved path params.** Two clients that connect
 *      with `{ roomId: 'r1' }` share a broadcast group; a third with
 *      `{ roomId: 'r2' }` does not. An empty-params channel puts
 *      every client in one global group, matching adapter behavior
 *      for endpoints like `/ws/notifications`.
 *   2. **Scoped broadcast maps.** `ctx.broadcast.*` hits every member
 *      of the group including the sender, `ctx.broadcastOthers.*`
 *      excludes the sender, and `ctx.send.*` targets only the sender.
 *   3. **Outgoing validation.** Every message sent via the outgoing
 *      maps is validated through the channel's `serverMessages[type]`
 *      schema with `.parse()`. A schema mismatch throws
 *      `ValidationException` — the runner catches it and surfaces a
 *      clear per-scenario failure.
 *
 * What it does NOT implement: a real socket, JSON envelope parsing,
 * ws close codes, or backpressure. Messages are delivered
 * synchronously into an in-memory array on each client. That's all
 * the runner needs to verify behavior-level expectations, and it
 * keeps the harness deterministic — every test either passes or
 * fails for behavior reasons, never for transport flakiness.
 *
 * We deliberately do NOT import from `@triad/fastify` — the harness
 * mirrors the hub semantics by construction so that the two
 * implementations stay decoupled and this package has no Fastify
 * dependency.
 */

import {
  type Channel,
  type ServiceContainer,
  type ModelSchema,
  type ModelShape,
  type SchemaNode,
  ValidationException,
} from '@triad/core';

import { ChannelTestClient } from './channel-client.js';

// ---------------------------------------------------------------------------
// Grouping by params
// ---------------------------------------------------------------------------

/**
 * Produce a stable key for a params object so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` always hash to the same group regardless of
 * insertion order. Matches `paramsKey` in the Fastify channel adapter.
 */
function paramsKey(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${String(v)}`).join('|');
}

// ---------------------------------------------------------------------------
// Handshake validation helpers
// ---------------------------------------------------------------------------

type ValidationLike = {
  success: boolean;
  data?: unknown;
  errors?: readonly { path?: string; message: string; code?: string }[];
};

/**
 * Validate one connection part against its declared model if present.
 * Returns the validated data, or throws a string error describing the
 * failure (caught by `connect` and mapped to a 4400 rejection).
 */
function validateConnectionPart(
  model: ModelSchema<Record<string, SchemaNode>> | undefined,
  raw: unknown,
  part: 'params' | 'query' | 'headers',
): Record<string, unknown> {
  if (!model) {
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return {};
    }
    return { ...(raw as Record<string, unknown>) };
  }
  const result = model.validate(raw) as ValidationLike;
  if (!result.success) {
    const detail = (result.errors ?? [])
      .map((e) => `${e.path || '<root>'}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid channel ${part}: ${detail}`);
  }
  return result.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Outgoing map scoping
// ---------------------------------------------------------------------------

type OutgoingScope = 'send' | 'broadcast' | 'broadcastOthers';

/**
 * Build an outgoing map (`broadcast` / `broadcastOthers` / `send`)
 * scoped to a specific sender. Each entry validates its argument
 * against the declared server-message schema and then delivers the
 * validated payload to the appropriate subset of the group.
 *
 * `.parse()` throws `ValidationException` on mismatch and we
 * intentionally let it propagate — the caller (handler wrapper)
 * catches it and marks the scenario failed.
 */
function buildOutgoingMap(
  channel: Channel,
  scope: OutgoingScope,
  sender: ChannelTestClient,
  group: () => Set<ChannelTestClient>,
): Record<string, (data: unknown) => void> {
  const map: Record<string, (data: unknown) => void> = {};
  for (const [type, config] of Object.entries(channel.serverMessages)) {
    map[type] = (data: unknown) => {
      const validated = config.schema.parse(data);
      if (scope === 'send') {
        sender.deliver(type, validated);
        return;
      }
      for (const peer of group()) {
        if (scope === 'broadcastOthers' && peer === sender) continue;
        peer.deliver(type, validated);
      }
    };
  }
  return map;
}

// ---------------------------------------------------------------------------
// ChannelHarness
// ---------------------------------------------------------------------------

export interface ConnectOptions {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

/**
 * Multi-client simulator for a single channel. One harness per
 * scenario — it is NOT shared across behaviors, because each scenario
 * gets its own fresh `services` instance via the runner's
 * `servicesFactory`.
 */
export class ChannelHarness {
  private readonly channel: Channel;
  private readonly services: ServiceContainer;

  /**
   * Registered (non-rejected) clients, keyed by id. Rejected clients
   * never enter this map, same as the Fastify adapter which closes
   * the socket before registration.
   */
  private readonly clients = new Map<string, ChannelTestClient>();

  /**
   * For each registered client, the raw connect ctx we built during
   * `connect` so `disconnect` can pass the same object to
   * `onDisconnect` — matches the adapter's behavior of reusing the
   * connect context for both lifecycle hooks.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly connectCtxs = new Map<string, any>();

  /** Groups by params key. Same data model as the Fastify hub. */
  private readonly groups = new Map<string, Set<ChannelTestClient>>();

  /** Temporary storage for beforeHandler state between steps of connect. */
  private _pendingBeforeState: Record<string, unknown> | undefined;

  constructor(channel: Channel, services: ServiceContainer) {
    this.channel = channel;
    this.services = services;
  }

  /**
   * Open a new simulated connection. Resolves whether the connection
   * was accepted or rejected — rejection is captured on the client
   * object, never thrown, so tests can assert on both outcomes with
   * the same code path.
   */
  async connect(
    clientId: string,
    opts: ConnectOptions = {},
  ): Promise<ChannelTestClient> {
    // ---- 0. beforeHandler -----------------------------------------------
    // Runs BEFORE schema validation so auth can reject before 4400.
    if (this.channel.beforeHandler) {
      try {
        const beforeResult = await this.channel.beforeHandler({
          rawParams: opts.params ?? {},
          rawQuery: opts.query ?? {},
          rawHeaders: opts.headers ?? {},
          services: this.services,
        });
        if (!beforeResult.ok) {
          const client = new ChannelTestClient(clientId, opts);
          client.rejected = true;
          client.rejectedCode = beforeResult.code;
          client.rejectedMessage = beforeResult.message;
          return client;
        }
        // Merge beforeHandler state into the client state below.
        this._pendingBeforeState = beforeResult.state as Record<string, unknown>;
      } catch (err) {
        const client = new ChannelTestClient(clientId, opts);
        client.rejected = true;
        client.rejectedCode = 4500;
        client.rejectedMessage =
          err instanceof Error ? err.message : String(err);
        return client;
      }
    }

    // ---- 1. Handshake validation ----------------------------------------
    // Mirrors the adapter: validate params, then query, then headers.
    // A validation failure becomes a synthetic 4400 rejection (the
    // same close code the real adapter uses for this case).
    let params: Record<string, unknown>;
    let query: Record<string, unknown>;
    let headers: Record<string, unknown>;

    try {
      params = validateConnectionPart(
        this.channel.connection.params,
        opts.params ?? {},
        'params',
      );
      query = validateConnectionPart(
        this.channel.connection.query,
        opts.query ?? {},
        'query',
      );
      headers = validateConnectionPart(
        this.channel.connection.headers,
        opts.headers ?? {},
        'headers',
      );
    } catch (err) {
      this._pendingBeforeState = undefined;
      const client = new ChannelTestClient(clientId, opts);
      client.rejected = true;
      client.rejectedCode = 4400;
      client.rejectedMessage =
        err instanceof Error ? err.message : String(err);
      return client;
    }

    const client = new ChannelTestClient(clientId, { params, query, headers });

    // Merge beforeHandler state into the client's state bag.
    if (this._pendingBeforeState) {
      Object.assign(client.state, this._pendingBeforeState);
      this._pendingBeforeState = undefined;
    }

    // ---- 2. Build connect context ---------------------------------------
    // `broadcast` here is pre-registration — matches adapter behavior
    // where a presence broadcast in `onConnect` only reaches existing
    // peers, not the newcomer (because the newcomer isn't in the
    // group yet).
    const key = paramsKey(params);
    const groupGetter = (): Set<ChannelTestClient> =>
      this.groups.get(key) ?? new Set();

    const connectBroadcast = buildOutgoingMap(
      this.channel,
      'broadcast',
      client,
      groupGetter,
    );

    const connectCtx = {
      params,
      query,
      headers,
      services: this.services,
      state: client.state,
      reject: (code: number, message: string) => {
        client.rejected = true;
        client.rejectedCode = code;
        client.rejectedMessage = message;
      },
      broadcast: connectBroadcast,
    };

    // ---- 3. Invoke onConnect --------------------------------------------
    if (this.channel.onConnect) {
      await this.channel.onConnect(connectCtx);
    }

    if (client.rejected) {
      return client;
    }

    // ---- 4. Register ----------------------------------------------------
    let group = this.groups.get(key);
    if (!group) {
      group = new Set();
      this.groups.set(key, group);
    }
    group.add(client);
    this.clients.set(clientId, client);
    this.connectCtxs.set(clientId, connectCtx);

    return client;
  }

  /**
   * Dispatch a client-to-server message. Validates the payload against
   * `clientMessages[messageType].schema` and then calls the
   * corresponding handler with a context whose outgoing maps are
   * scoped to the sending client's group.
   *
   * Throws on:
   *   - Unknown sender id
   *   - Undeclared message type
   *   - Incoming payload validation failure
   *   - Outgoing payload validation failure (ValidationException from
   *     a handler that broadcasts an invalid shape)
   *
   * The runner catches these and reports structured failures.
   */
  async send(
    clientId: string,
    messageType: string,
    data: unknown,
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(
        `ChannelHarness.send: no client with id "${clientId}" is connected`,
      );
    }

    const messageConfig = this.channel.clientMessages[messageType];
    if (!messageConfig) {
      throw new Error(
        `ChannelHarness.send: channel "${this.channel.name}" does not declare a client message "${messageType}". ` +
          `Declared: ${Object.keys(this.channel.clientMessages).join(', ') || '(none)'}`,
      );
    }

    const validated = messageConfig.schema.validate(data) as ValidationLike;
    if (!validated.success) {
      // Surface the errors via ValidationException so the runner can
      // treat incoming-payload failures the same way it treats
      // outgoing-payload failures — a single clear failure path.
      throw new ValidationException(
        (validated.errors ?? []).map((e) => ({
          path: e.path ?? '',
          message: e.message,
          code: e.code ?? 'validation_error',
        })),
      );
    }

    const handler = this.channel.handlers[messageType];
    if (!handler) {
      throw new Error(
        `ChannelHarness.send: channel "${this.channel.name}" has no handler for "${messageType}"`,
      );
    }

    const key = paramsKey(client.params);
    const groupGetter = (): Set<ChannelTestClient> =>
      this.groups.get(key) ?? new Set();

    const messageCtx = {
      params: client.params,
      services: this.services,
      state: client.state,
      broadcast: buildOutgoingMap(this.channel, 'broadcast', client, groupGetter),
      broadcastOthers: buildOutgoingMap(
        this.channel,
        'broadcastOthers',
        client,
        groupGetter,
      ),
      send: buildOutgoingMap(this.channel, 'send', client, groupGetter),
    };

    await handler(messageCtx, validated.data);
  }

  /**
   * Close a simulated connection. Calls `onDisconnect` with the same
   * context object that was passed to `onConnect` — exactly like the
   * adapter does — and removes the client from its group.
   */
  async disconnect(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const key = paramsKey(client.params);
    const group = this.groups.get(key);
    if (group) {
      group.delete(client);
      if (group.size === 0) this.groups.delete(key);
    }
    this.clients.delete(clientId);

    const ctx = this.connectCtxs.get(clientId);
    this.connectCtxs.delete(clientId);

    if (this.channel.onDisconnect && ctx) {
      await this.channel.onDisconnect(ctx);
    }
  }

  /** Look up a registered client by id. Rejected clients are NOT here. */
  getClient(clientId: string): ChannelTestClient | undefined {
    return this.clients.get(clientId);
  }

  /** Every currently connected client. Useful for `"*"`-scoped assertions. */
  allClients(): ChannelTestClient[] {
    return [...this.clients.values()];
  }
}

// Re-export for the `ModelShape` reference used in JSDoc; keeps the
// import side-effect-free for downstream users who only want the
// harness.
export type { ModelShape };
