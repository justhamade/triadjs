/**
 * Real-time chat room channel — the WebSocket counterpart to the
 * petstore's HTTP endpoints. Demonstrates:
 *
 *   - Declaring a channel with typed connection params and headers
 *   - Using the phantom state witness pattern for typed `ctx.state`
 *   - Authenticating on handshake via headers (and rejecting with
 *     `ctx.reject` when credentials are missing)
 *   - Broadcasting to every client in the same room (scoped by the
 *     `roomId` path parameter)
 *   - Using `broadcastOthers` so typing indicators are NOT echoed
 *     back to the sender
 *   - Validating outgoing messages automatically via the
 *     `serverMessages` schemas
 *   - Exercising the Phase 9.4 channel test runner with realistic
 *     behavior scenarios
 *
 * The handlers delegate to a plain in-memory `MessageStore` injected
 * via `ctx.services` — same pattern as the HTTP endpoint handlers.
 */

import { channel, scenario, t } from '@triad/core';
import {
  ChatMessage,
  ChannelError,
  SendMessagePayload,
  TypingIndicator,
  TypingPayload,
  UserPresence,
} from '../schemas/chat.js';

interface ChatRoomState {
  userId: string;
  userName: string;
  roomId: string;
}

export const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat room',
  description:
    'Bidirectional messaging channel for a specific chat room. Clients authenticate via `x-user-id` and `x-user-name` headers, then can send messages and typing indicators. Presence events announce joins and leaves.',
  tags: ['Chat'],

  // Phantom witness for typed ctx.state — see ChannelConfig docs for why
  // this uses a field instead of an explicit type argument.
  state: {} as ChatRoomState,

  connection: {
    params: {
      roomId: t.string().format('uuid').doc('Room to join'),
    },
    headers: {
      'x-user-id': t
        .string()
        .format('uuid')
        .doc('Authenticated user identifier'),
      'x-user-name': t
        .string()
        .minLength(1)
        .doc('Display name at connect time'),
    },
  },

  clientMessages: {
    sendMessage: {
      schema: SendMessagePayload,
      description: 'Post a chat message to the room',
    },
    typing: {
      schema: TypingPayload,
      description: 'Update the sender typing state',
    },
  },

  serverMessages: {
    message: { schema: ChatMessage, description: 'New chat message' },
    typing: {
      schema: TypingIndicator,
      description: 'Typing status update from another user',
    },
    presence: {
      schema: UserPresence,
      description: 'A user joined or left the room',
    },
    error: {
      schema: ChannelError,
      description: 'An error occurred handling a client message',
    },
  },

  onConnect: async (ctx) => {
    ctx.state.userId = ctx.headers['x-user-id'];
    ctx.state.userName = ctx.headers['x-user-name'];
    ctx.state.roomId = ctx.params.roomId;

    // The broadcast is built BEFORE registration, so only existing
    // peers (not the newcomer) see the "joined" event. That's the
    // intuitive "who's already here" semantic.
    ctx.broadcast.presence({
      userId: ctx.state.userId,
      userName: ctx.state.userName,
      action: 'joined',
    });
  },

  onDisconnect: async (ctx) => {
    // onDisconnect fires for every close — normal, abnormal, rejection.
    // Only broadcast a "left" event if we actually completed onConnect,
    // i.e. the user is in our state bag.
    if (ctx.state.userId) {
      ctx.broadcast.presence({
        userId: ctx.state.userId,
        userName: ctx.state.userName,
        action: 'left',
      });
    }
  },

  handlers: {
    sendMessage: async (ctx, data) => {
      const message = await ctx.services.messageStore.create({
        roomId: ctx.state.roomId,
        userId: ctx.state.userId,
        userName: ctx.state.userName,
        text: data.text,
      });
      ctx.broadcast.message(message);
    },

    typing: async (ctx, data) => {
      // broadcastOthers excludes the sender so typing indicators
      // aren't echoed back.
      ctx.broadcastOthers.typing({
        userId: ctx.state.userId,
        isTyping: data.isTyping,
      });
    },
  },

  behaviors: [
    scenario('Users can post messages to a room they have joined')
      .given('alice is connected to the chat room')
      .setup(async () => ({
        roomId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-00000000aaaa',
      }))
      .params({ roomId: '{roomId}' })
      .headers({
        'x-user-id': '{userId}',
        'x-user-name': 'Alice',
      })
      .body({ text: 'Hello everyone' })
      .when('client sends sendMessage')
      .then('client receives a message event')
      .and('client receives a message with text "Hello everyone"'),

    scenario('Posted messages are persisted via the MessageStore')
      .given('alice is connected to the chat room')
      .setup(async () => ({
        roomId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-00000000aaaa',
      }))
      .params({ roomId: '{roomId}' })
      .headers({
        'x-user-id': '{userId}',
        'x-user-name': 'Alice',
      })
      .body({ text: 'Persisted message' })
      .when('client sends sendMessage')
      .then('client receives a message event'),
  ],
});
