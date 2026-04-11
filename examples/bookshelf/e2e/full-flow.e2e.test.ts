/**
 * End-to-end full-flow test.
 *
 * Walks a single user through the whole Bookshelf story over real
 * HTTP and real WebSocket transports:
 *
 *   1. Register via POST /auth/register
 *   2. Create a book via POST /books
 *   3. Open the bookReviews WebSocket for that book
 *   4. Submit a review through the WS channel
 *   5. Receive the broadcast back on the same socket
 *   6. Fetch the book via HTTP to confirm it's still there
 *
 * Every step touches a different layer — Fastify HTTP routing,
 * Drizzle+SQLite persistence, Fastify WebSocket upgrade, channel
 * handler + broadcast, and HTTP GET — and the whole flow runs against
 * a single server instance on an ephemeral port.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startE2eServer, type E2eHarness } from './setup.js';

interface Envelope {
  type: string;
  data: unknown;
}

function waitForType(socket: WebSocket, type: string): Promise<Envelope> {
  return new Promise<Envelope>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, 2000);

    function onMessage(raw: RawData): void {
      let parsed: Envelope;
      try {
        parsed = JSON.parse(
          (raw as Buffer | string).toString(),
        ) as Envelope;
      } catch {
        return;
      }
      if (parsed.type === type) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(parsed);
      }
    }
    socket.on('message', onMessage);
  });
}

describe('bookshelf full flow e2e', () => {
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

  it('walks register → create book → WS review broadcast end-to-end', async () => {
    // 1. Register
    const regResp = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'pw1234',
        name: 'Alice',
      }),
    });
    expect(regResp.status).toBe(201);
    const reg = (await regResp.json()) as { token: string };

    // 2. Create a book
    const bookResp = await fetch(`${harness.baseUrl}/books`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${reg.token}`,
      },
      body: JSON.stringify({
        title: 'Dune',
        author: 'Frank Herbert',
        publishedYear: 1965,
      }),
    });
    expect(bookResp.status).toBe(201);
    const book = (await bookResp.json()) as { id: string; title: string };

    // 3. Open the WS channel for that book
    const socket: WebSocket = await new Promise((resolve, reject) => {
      const s = new WebSocket(
        `${harness.wsBaseUrl}/ws/books/${book.id}/reviews`,
        { headers: { authorization: `Bearer ${reg.token}` } },
      );
      s.once('open', () => resolve(s));
      s.once('error', (err) => reject(err));
    });
    sockets.push(socket);

    // 4. Submit a review via the channel
    const waitReview = waitForType(socket, 'review');
    socket.send(
      JSON.stringify({
        type: 'submitReview',
        data: { rating: { score: 5 }, comment: 'A masterpiece.' },
      }),
    );

    // 5. Receive the broadcast on the same socket
    const envelope = await waitReview;
    const reviewData = envelope.data as { comment: string };
    expect(reviewData.comment).toBe('A masterpiece.');

    // 6. Fetch the book via HTTP — still owned by the caller.
    const fetchResp = await fetch(`${harness.baseUrl}/books/${book.id}`, {
      headers: { authorization: `Bearer ${reg.token}` },
    });
    expect(fetchResp.status).toBe(200);
    const fetched = (await fetchResp.json()) as { title: string };
    expect(fetched.title).toBe('Dune');
  });
});
