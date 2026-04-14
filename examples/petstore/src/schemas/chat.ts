/**
 * Chat room schemas — the Chat bounded context.
 *
 * These schemas are the source of truth for both the WebSocket
 * `chatRoom` channel (in `src/channels/chat-room.ts`) AND a potential
 * HTTP history endpoint. Because Triad treats `t.model()` as
 * protocol-agnostic, `ChatMessage` can be returned from a REST endpoint
 * (`GET /rooms/:id/messages`) and broadcast over a channel without any
 * duplication — declare it once, use it everywhere.
 *
 * The example demonstrates a small but realistic channel surface:
 *
 *   - `sendMessage` — a client posts a message to the room
 *   - `typing` — a client signals typing status
 *   - `message` — the server broadcasts new messages to everyone
 *   - `typing` — the server forwards typing status to OTHER clients
 *   - `presence` — the server announces joins/leaves
 *   - `error` — the server signals problems (schema validation, etc.)
 */

import { t } from '@triadjs/core';

// ---------------------------------------------------------------------------
// Server messages (things the channel pushes to clients)
// ---------------------------------------------------------------------------

export const ChatMessage = t.model('ChatMessage', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique message id'),
  roomId: t
    .string()
    .format('uuid')
    .storage({ indexed: true })
    .doc('The room this message belongs to'),
  userId: t
    .string()
    .format('uuid')
    .doc('User who sent the message'),
  userName: t.string().minLength(1).doc('Display name at send time'),
  text: t
    .string()
    .minLength(1)
    .maxLength(2000)
    .doc('Message body'),
  timestamp: t
    .datetime()
    .storage({ defaultNow: true })
    .doc('When the message was created (server-set)'),
});

export const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string().format('uuid').doc('User whose typing state changed'),
  isTyping: t.boolean().doc('Whether they are currently typing'),
});

export const UserPresence = t.model('UserPresence', {
  userId: t.string().format('uuid').doc('User whose presence changed'),
  userName: t.string().minLength(1).doc('Display name'),
  action: t.enum('joined', 'left').doc('What happened'),
});

export const ChannelError = t.model('ChannelError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});

// ---------------------------------------------------------------------------
// Client messages (things clients send to the channel)
// ---------------------------------------------------------------------------

export const SendMessagePayload = t.model('SendMessagePayload', {
  text: t
    .string()
    .minLength(1)
    .maxLength(2000)
    .doc('Message text to post'),
});

export const TypingPayload = t.model('TypingPayload', {
  isTyping: t.boolean().doc('Current typing state'),
});
