/**
 * In-process test client for a Triad WebSocket channel.
 *
 * `ChannelTestClient` is the channel analog of `supertest` for HTTP. It
 * represents one simulated WebSocket connection inside the harness: it
 * remembers the handshake inputs, captures every message the server
 * delivered to it, exposes the per-connection state bag that handlers
 * mutate, and records whether the handshake was rejected.
 *
 * The class is deliberately thin — it only owns data. The
 * `ChannelHarness` decides *when* to deliver a message by calling
 * `client.deliver(type, data)`, and the runner/assertion executor
 * reads `client.received` to verify expectations. Keeping policy out
 * of the client lets us reuse it for both single-client and multi-
 * client scenarios without special-casing either.
 */

/** A server message that was delivered to this client by the harness. */
export interface ReceivedMessage {
  type: string;
  data: unknown;
}

/**
 * A simulated connection to a Triad channel. Multi-client scenarios
 * hold one of these per participant — e.g. `alice` and `bob` in the
 * same room — and compare their `received` arrays to assert fan-out
 * behavior.
 */
export class ChannelTestClient {
  readonly id: string;
  readonly received: ReceivedMessage[] = [];
  /**
   * The per-connection state bag the handlers mutate. Starts empty and
   * is handed to `onConnect`, every message handler, and `onDisconnect`
   * — same identity throughout a connection, same semantics as the
   * real Fastify adapter.
   */
  readonly state: Record<string, unknown> = {};
  readonly params: Record<string, unknown>;
  readonly query: Record<string, unknown>;
  readonly headers: Record<string, unknown>;

  /** True once `ctx.reject(...)` has been called or validation failed. */
  rejected = false;
  /** HTTP-style code passed to `ctx.reject(code, message)`. */
  rejectedCode?: number;
  /** Message passed to `ctx.reject(code, message)`. */
  rejectedMessage?: string;

  constructor(
    id: string,
    parts: {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    } = {},
  ) {
    this.id = id;
    this.params = parts.params ?? {};
    this.query = parts.query ?? {};
    this.headers = parts.headers ?? {};
  }

  /**
   * Record a server message that targeted this client. Called by the
   * harness when a handler invokes `ctx.broadcast.*`, `ctx.send.*`, or
   * `ctx.broadcastOthers.*` and this client is in scope.
   */
  deliver(type: string, data: unknown): void {
    this.received.push({ type, data });
  }

  /** Convenience: filter `received` by message type. */
  receivedOf(type: string): ReceivedMessage[] {
    return this.received.filter((m) => m.type === type);
  }
}
