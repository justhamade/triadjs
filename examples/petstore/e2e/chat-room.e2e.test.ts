/**
 * End-to-end WebSocket tests for the chat-room channel.
 *
 * These tests open real `ws` sockets against a real Fastify server on
 * an ephemeral port. They exercise the chat-room channel's handshake
 * validation, broadcast semantics, and `broadcastOthers` (typing
 * indicators) — all the things that an in-process harness cannot
 * observe because they only surface at real-frame granularity.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startE2eServer, type E2eHarness } from './setup.js';

interface Envelope {
  type: string;
  data: unknown;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (env: Envelope) => boolean = () => true,
  timeoutMs = 2000,
): Promise<Envelope> {
  return new Promise<Envelope>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for message'));
    }, timeoutMs);

    function onMessage(raw: RawData): void {
      let parsed: Envelope;
      try {
        parsed = JSON.parse(
          (raw as Buffer | string).toString(),
        ) as Envelope;
      } catch {
        return;
      }
      if (predicate(parsed)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(parsed);
      }
    }
    socket.on('message', onMessage);
  });
}

function waitForType(socket: WebSocket, type: string): Promise<Envelope> {
  return waitForMessage(socket, (env) => env.type === type);
}

function openSocket(
  wsBaseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`${wsBaseUrl}${path}`, { headers });
    socket.once('open', () => resolve(socket));
    socket.once('error', (err) => reject(err));
    socket.once('close', (code, reason) => {
      reject(
        new Error(
          `socket closed before open: code=${code} reason=${reason.toString()}`,
        ),
      );
    });
  });
}

describe('chat-room e2e', () => {
  let harness: E2eHarness;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    harness = await startE2eServer();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    }
    sockets.length = 0;
    await harness.close();
  });

  const roomId = '00000000-0000-0000-0000-000000000001';
  const alice = {
    'x-user-id': '00000000-0000-0000-0000-00000000aaaa',
    'x-user-name': 'Alice',
  };
  const bob = {
    'x-user-id': '00000000-0000-0000-0000-00000000bbbb',
    'x-user-name': 'Bob',
  };

  it('broadcasts a sendMessage from alice to bob (both subscribers)', async () => {
    const aliceSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      alice,
    );
    sockets.push(aliceSocket);
    const bobSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      bob,
    );
    sockets.push(bobSocket);

    const aliceWait = waitForType(aliceSocket, 'message');
    const bobWait = waitForType(bobSocket, 'message');

    aliceSocket.send(
      JSON.stringify({
        type: 'sendMessage',
        data: { text: 'hello everyone' },
      }),
    );

    const [aliceMsg, bobMsg] = await Promise.all([aliceWait, bobWait]);
    expect(aliceMsg.type).toBe('message');
    expect(bobMsg.type).toBe('message');
    const aliceData = aliceMsg.data as { text: string; userName: string };
    expect(aliceData.text).toBe('hello everyone');
    expect(aliceData.userName).toBe('Alice');
    const bobData = bobMsg.data as { text: string; userName: string };
    expect(bobData.text).toBe('hello everyone');
  });

  it('persists broadcast messages via the MessageStore', async () => {
    const aliceSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      alice,
    );
    sockets.push(aliceSocket);

    const wait = waitForType(aliceSocket, 'message');
    aliceSocket.send(
      JSON.stringify({ type: 'sendMessage', data: { text: 'persist me' } }),
    );
    await wait;

    const stored = await harness.services.messageStore.listByRoom(roomId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe('persist me');
  });

  it('typing indicators use broadcastOthers — the sender is not echoed', async () => {
    const aliceSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      alice,
    );
    sockets.push(aliceSocket);
    const bobSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      bob,
    );
    sockets.push(bobSocket);

    const bobWait = waitForType(bobSocket, 'typing');
    aliceSocket.send(
      JSON.stringify({ type: 'typing', data: { isTyping: true } }),
    );

    const envelope = await bobWait;
    const data = envelope.data as { userId: string; isTyping: boolean };
    expect(data.userId).toBe(alice['x-user-id']);
    expect(data.isTyping).toBe(true);
  });

  it('broadcasts a presence event when a second user joins', async () => {
    const aliceSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      alice,
    );
    sockets.push(aliceSocket);

    // Start listening BEFORE bob joins — otherwise the "joined"
    // presence broadcast can race past `waitForType` setup. The
    // returned promise is attached before we open bob's socket.
    const aliceWait = waitForType(aliceSocket, 'presence');

    const bobSocket = await openSocket(
      harness.wsBaseUrl,
      `/ws/rooms/${roomId}`,
      bob,
    );
    sockets.push(bobSocket);

    const envelope = await aliceWait;
    const data = envelope.data as { action: string; userName: string };
    expect(data.action).toBe('joined');
    expect(data.userName).toBe('Bob');
  });
});
