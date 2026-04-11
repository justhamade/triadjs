/**
 * Runtime tests for the shared connection pool added in Phase 13.4.
 *
 * These tests transpile the `client-template.ts` runtime source with
 * the TypeScript compiler and evaluate it in a fresh sandbox per
 * test, so each test gets an isolated pool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRuntime,
  FakeWebSocket,
  type RuntimeExports,
  type BaseChannelClientLike,
  type ChannelStateLike,
} from './runtime-helpers.js';

describe('BaseChannelClient shared connection pool', () => {
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
      shared: true,
      WebSocketImpl: FakeWebSocket,
      ...overrides,
    });
  }

  it('shares one underlying socket when two clients have the same key', () => {
    makeClient();
    makeClient();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('opens separate sockets for clients with different URLs', () => {
    makeClient({ url: 'ws://host/ws/rooms/abc' });
    makeClient({ url: 'ws://host/ws/rooms/xyz' });
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('opens separate sockets for clients with different query', () => {
    makeClient({ query: { a: '1' } });
    makeClient({ query: { a: '2' } });
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('treats non-shared clients as independent even with same URL', () => {
    makeClient({ shared: false });
    makeClient({ shared: false });
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('closing one subscriber does not close the shared socket while others remain', async () => {
    const a = makeClient();
    makeClient();
    FakeWebSocket.instances[0]!.simulateOpen();
    await a.close();
    expect(FakeWebSocket.instances[0]!.closed).toBe(false);
  });

  it('closing the last subscriber starts the grace timer before teardown', async () => {
    const a = makeClient({ sharedCloseDelayMs: 50 });
    FakeWebSocket.instances[0]!.simulateOpen();
    await a.close();
    // Socket not closed synchronously — grace timer pending.
    expect(FakeWebSocket.instances[0]!.closed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
  });

  it('new subscriber joining during grace period cancels teardown', async () => {
    const a = makeClient({ sharedCloseDelayMs: 50 });
    FakeWebSocket.instances[0]!.simulateOpen();
    await a.close();
    // Join during grace window
    makeClient({ sharedCloseDelayMs: 50 });
    await new Promise((r) => setTimeout(r, 80));
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(FakeWebSocket.instances[0]!.closed).toBe(false);
  });

  it('sharedCloseDelayMs: 0 closes immediately when refCount drops to 0', async () => {
    const a = makeClient({ sharedCloseDelayMs: 0 });
    FakeWebSocket.instances[0]!.simulateOpen();
    await a.close();
    await new Promise((r) => setTimeout(r, 5));
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
  });

  it('fans out incoming messages to every subscriber callback', () => {
    const a = makeClient();
    const b = makeClient();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    a.onMessage('greet', (p) => seenA.push(p));
    b.onMessage('greet', (p) => seenB.push(p));
    FakeWebSocket.instances[0]!.simulateOpen();
    FakeWebSocket.instances[0]!.simulateMessage(
      JSON.stringify({ type: 'greet', data: { hi: 1 } }),
    );
    expect(seenA).toEqual([{ hi: 1 }]);
    expect(seenB).toEqual([{ hi: 1 }]);
  });

  it('routes send() from any subscriber through the shared socket once', () => {
    const a = makeClient();
    makeClient();
    FakeWebSocket.instances[0]!.simulateOpen();
    a.send('ping', { n: 1 });
    expect(FakeWebSocket.instances[0]!.sentMessages).toEqual([
      JSON.stringify({ type: 'ping', data: { n: 1 } }),
    ]);
  });

  it('broadcasts state changes to every subscriber', () => {
    const a = makeClient();
    const b = makeClient();
    const statesA: ChannelStateLike[] = [];
    const statesB: ChannelStateLike[] = [];
    a.onStateChange((s) => statesA.push(s));
    b.onStateChange((s) => statesB.push(s));
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(statesA).toContain('open');
    expect(statesB).toContain('open');
  });

  it('grows the pool size when new keys join and shrinks when torn down', async () => {
    expect(runtime.__internals.getPool().size()).toBe(0);
    const a = makeClient({ sharedCloseDelayMs: 0 });
    expect(runtime.__internals.getPool().size()).toBe(1);
    FakeWebSocket.instances[0]!.simulateOpen();
    await a.close();
    await new Promise((r) => setTimeout(r, 5));
    expect(runtime.__internals.getPool().size()).toBe(0);
  });
});
