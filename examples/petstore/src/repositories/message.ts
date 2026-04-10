/**
 * In-memory chat message store.
 *
 * For the reference example we keep chat messages ephemeral — they
 * live in memory, scoped by roomId, and evaporate when the server
 * restarts. A real app would back this with a `messages` table in
 * Drizzle (the pattern is identical to `PetRepository` — add an
 * `sqliteTable`, write `rowToApi` / `apiToRow`, done).
 *
 * The repository lives alongside the existing Drizzle-backed repos to
 * emphasize that Triad services are heterogeneous by design: one
 * process can mix SQL-backed and in-memory stores without the channel
 * or endpoint handlers caring where their data lives.
 */

import type { Infer } from '@triad/core';
import type { ChatMessage } from '../schemas/chat.js';

type Message = Infer<typeof ChatMessage>;

export interface CreateMessageInput {
  roomId: string;
  userId: string;
  userName: string;
  text: string;
}

export class MessageStore {
  private readonly messages: Message[] = [];

  async create(input: CreateMessageInput): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      roomId: input.roomId,
      userId: input.userId,
      userName: input.userName,
      text: input.text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(message);
    return message;
  }

  async listByRoom(roomId: string): Promise<Message[]> {
    return this.messages.filter((m) => m.roomId === roomId);
  }

  async clear(): Promise<void> {
    this.messages.length = 0;
  }
}
