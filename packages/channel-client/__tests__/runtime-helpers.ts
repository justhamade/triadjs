/**
 * Test helper: compile and evaluate the `client-template.ts` runtime
 * string so tests can exercise the real `BaseChannelClient` class.
 *
 * The template is emitted as TypeScript source; we transpile it to
 * CJS with `ts.transpileModule` and run it inside a fresh `new
 * Function(...)` sandbox so each test gets an isolated module with a
 * fresh connection pool.
 */

import ts from 'typescript';
import { renderClientRuntime } from '../src/client-template.js';

export interface RuntimeExports {
  BaseChannelClient: new (options: unknown) => BaseChannelClientLike;
  __internals: {
    getPool(): PoolLike;
  };
}

export interface BaseChannelClientLike {
  readonly state: ChannelStateLike;
  send(type: string, payload: unknown): void;
  onMessage(type: string, cb: (payload: unknown) => void): () => void;
  onStateChange(cb: (state: ChannelStateLike) => void): () => void;
  onOpen(cb: () => void): () => void;
  onClose(cb: (event: { code: number; reason: string }) => void): () => void;
  onError(cb: (error: unknown) => void): () => void;
  close(): Promise<void>;
}

export type ChannelStateLike = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface PoolLike {
  size(): number;
}

export function loadRuntime(): RuntimeExports {
  const source = renderClientRuntime({ baseUrl: '/' });
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: false,
    },
  });
  const exportsObj: Record<string, unknown> = {};
  const moduleObj = { exports: exportsObj };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', transpiled.outputText);
  fn(moduleObj, exportsObj);
  return moduleObj.exports as unknown as RuntimeExports;
}

/**
 * Minimal fake WebSocket compatible with the `WebSocket` DOM
 * interface surface that `BaseChannelClient` actually uses:
 * `addEventListener`, `send`, `close`, `readyState`.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState: 0 | 1 | 2 | 3 = 0;
  sentMessages: string[] = [];
  closed = false;

  private readonly listeners = new Map<string, Set<(arg: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(event: string, cb: (arg: unknown) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  removeEventListener(event: string, cb: (arg: unknown) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed = true;
    this.dispatch('close', { code: 1000, reason: 'normal' });
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }

  simulateMessage(data: string): void {
    this.dispatch('message', { data });
  }

  simulateClose(code = 1000, reason = 'normal'): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatch('close', { code, reason });
  }

  simulateError(err: unknown = new Error('boom')): void {
    this.dispatch('error', err);
  }

  private dispatch(event: string, arg: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(arg);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}
