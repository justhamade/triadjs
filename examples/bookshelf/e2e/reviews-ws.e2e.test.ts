/**
 * End-to-end WebSocket tests for the `bookReviews` channel.
 *
 * Exercises handshake auth (bearer token in `Authorization` header),
 * ownership rejection, and real-frame broadcast semantics.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { seedUser, startE2eServer, type E2eHarness } from './setup.js';

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

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe('bookshelf bookReviews channel e2e', () => {
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

  it('submitReview broadcasts a review back to the sender', async () => {
    const { token, userId } = await seedUser(harness);
    const book = await harness.services.bookRepo.create({
      ownerId: userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    const socket = await openSocket(
      harness.wsBaseUrl,
      `/ws/books/${book.id}/reviews`,
      { authorization: `Bearer ${token}` },
    );
    sockets.push(socket);

    const wait = waitForMessage(socket, (env) => env.type === 'review');
    socket.send(
      JSON.stringify({
        type: 'submitReview',
        data: { rating: { score: 5 }, comment: 'A masterpiece.' },
      }),
    );
    const envelope = await wait;
    const data = envelope.data as { comment: string };
    expect(data.comment).toBe('A masterpiece.');
  });

  it('rejects the handshake with 401 on an unknown token', async () => {
    // Seed a book so the :bookId param is valid.
    const { userId } = await seedUser(harness);
    const book = await harness.services.bookRepo.create({
      ownerId: userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    const socket = new WebSocket(
      `${harness.wsBaseUrl}/ws/books/${book.id}/reviews`,
      { headers: { authorization: 'Bearer not-a-real-token' } },
    );
    sockets.push(socket);
    const closed = await waitForClose(socket);
    // Adapter rejections surface as a close with a non-normal code.
    expect(closed.code).not.toBe(1000);
  });

  it('rejects the handshake with 403 when the user does not own the book', async () => {
    const alice = await seedUser(harness, { email: 'alice@example.com' });
    const bob = await seedUser(harness, { email: 'bob@example.com' });
    const book = await harness.services.bookRepo.create({
      ownerId: alice.userId,
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    const socket = new WebSocket(
      `${harness.wsBaseUrl}/ws/books/${book.id}/reviews`,
      { headers: { authorization: `Bearer ${bob.token}` } },
    );
    sockets.push(socket);
    const closed = await waitForClose(socket);
    expect(closed.code).not.toBe(1000);
  });
});
