/**
 * Runtime tests for the offline send queue added in Phase 13.4.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRuntime,
  FakeWebSocket,
  type RuntimeExports,
  type BaseChannelClientLike,
} from './runtime-helpers.js';

describe('BaseChannelClient offline send queue', () => {
  let runtime: RuntimeExports;

  beforeEach(() => {
    FakeWebSocket.reset();
    runtime = loadRuntime();
  });

  function makeClient(
    overrides: Record<string, unknown> = {},
  ): BaseChannelClientLike {
    return new runtime.BaseChannelClient({
      url: 'ws://host/ws/rooms/abc',
      WebSocketImpl: FakeWebSocket,
      queueOfflineSends: true,
      ...overrides,
    });
  }

  it('queues sends while state === connecting instead of dispatching', () => {
    const c = makeClient();
    c.send('ping', { n: 1 });
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([]);
  });

  it('sends immediately while state === open', () => {
    const c = makeClient();
    FakeWebSocket.instances[0]!.simulateOpen();
    c.send('ping', { n: 1 });
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([
      JSON.stringify({ type: 'ping', data: { n: 1 } }),
    ]);
  });

  it('flushes queued sends in FIFO order when the socket opens', () => {
    const c = makeClient();
    c.send('a', 1);
    c.send('b', 2);
    c.send('c', 3);
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([
      JSON.stringify({ type: 'a', data: 1 }),
      JSON.stringify({ type: 'b', data: 2 }),
      JSON.stringify({ type: 'c', data: 3 }),
    ]);
  });

  it('drops the oldest message when maxQueueSize is exceeded', () => {
    const c = makeClient({ maxQueueSize: 2 });
    c.send('a', 1);
    c.send('b', 2);
    c.send('c', 3);
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([
      JSON.stringify({ type: 'b', data: 2 }),
      JSON.stringify({ type: 'c', data: 3 }),
    ]);
  });

  it('invokes onQueueDropped with the dropped entry when queue overflows', () => {
    const dropped: Array<{ type: string; payload: unknown }> = [];
    const c = makeClient({
      maxQueueSize: 1,
      onQueueDropped: (d: { type: string; payload: unknown }) => dropped.push(d),
    });
    c.send('a', 1);
    c.send('b', 2);
    expect(dropped).toEqual([{ type: 'a', payload: 1 }]);
  });

  it('close() drops queued messages without flushing', async () => {
    const c = makeClient();
    c.send('a', 1);
    c.send('b', 2);
    await c.close();
    // Open event never occurred; explicit close drops the queue.
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([]);
  });

  it('default behavior (queueOfflineSends: false) throws on send while not open', () => {
    const c = new runtime.BaseChannelClient({
      url: 'ws://host/ws/rooms/abc',
      WebSocketImpl: FakeWebSocket,
    });
    expect(() => c.send('a', 1)).toThrow();
  });

  it('shared pool: all subscribers contribute to one queue and flush once', () => {
    const a = new runtime.BaseChannelClient({
      url: 'ws://host/ws/rooms/abc',
      WebSocketImpl: FakeWebSocket,
      shared: true,
      queueOfflineSends: true,
    });
    const b = new runtime.BaseChannelClient({
      url: 'ws://host/ws/rooms/abc',
      WebSocketImpl: FakeWebSocket,
      shared: true,
      queueOfflineSends: true,
    });
    a.send('a', 1);
    b.send('b', 2);
    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([
      JSON.stringify({ type: 'a', data: 1 }),
      JSON.stringify({ type: 'b', data: 2 }),
    ]);
  });

  it('queue survives a reconnect and flushes on the next open transition', () => {
    const c = makeClient({
      reconnect: { enabled: true, initialDelayMs: 1, jitter: false, maxAttempts: 5 },
    });
    FakeWebSocket.instances[0]!.simulateOpen();
    // Socket drops — BaseChannelClient enters reconnecting
    FakeWebSocket.instances[0]!.simulateClose(1006, 'network');
    c.send('buffered', 99);
    // No second socket yet, or the new one hasn't opened; first has 0 msgs.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        next.simulateOpen();
        expect(next.sentMessages).toContain(
          JSON.stringify({ type: 'buffered', data: 99 }),
        );
        resolve();
      }, 20);
    });
  });
});
