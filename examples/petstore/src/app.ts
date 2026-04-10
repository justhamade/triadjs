/**
 * Router definition — the entry point consumed by `triad.config.ts` and
 * `src/server.ts`.
 *
 * Endpoints are grouped into DDD bounded contexts rather than flat
 * top-level registration. Each context declares its own ubiquitous
 * language via `models[]`, which the `triad validate` command uses to
 * detect cross-context leakage.
 */

import { createRouter } from '@triad/core';
import {
  createPet,
  getPet,
  listPets,
  updatePet,
} from './endpoints/pets.js';
import {
  createAdopter,
  requestAdoption,
  completeAdoption,
} from './endpoints/adoptions.js';
import { chatRoom } from './channels/chat-room.js';
import { Pet, CreatePet, UpdatePet } from './schemas/pet.js';
import {
  Adopter,
  Adoption,
  AdoptionRequest,
  CreateAdopter,
} from './schemas/adoption.js';
import {
  ChannelError,
  ChatMessage,
  SendMessagePayload,
  TypingIndicator,
  TypingPayload,
  UserPresence,
} from './schemas/chat.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description:
    'Triad reference example — a full petstore API demonstrating schemas, bounded contexts, value objects, repositories, Fastify integration, and behavior tests.',
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
});

router.context(
  'Pets',
  {
    description: 'Pet catalog and CRUD operations.',
    models: [Pet, CreatePet, UpdatePet, ApiError],
  },
  (ctx) => {
    ctx.add(createPet, getPet, listPets, updatePet);
  },
);

router.context(
  'Adoption',
  {
    description: 'Adopter registration and adoption lifecycle.',
    models: [
      // Adoption endpoints touch pets too, so the Pet model is intentionally
      // included here even though the Pets context owns its canonical shape.
      Pet,
      Adopter,
      CreateAdopter,
      Adoption,
      AdoptionRequest,
      ApiError,
    ],
  },
  (ctx) => {
    ctx.add(createAdopter, requestAdoption, completeAdoption);
  },
);

// Chat is a bounded context holding a single WebSocket channel.
// Bounded contexts can mix HTTP endpoints and channels — a future
// addition would be an HTTP endpoint `GET /rooms/:id/messages` for
// pulling history via REST.
router.context(
  'Chat',
  {
    description: 'Real-time chat rooms backed by WebSocket channels.',
    models: [
      ChatMessage,
      TypingIndicator,
      UserPresence,
      SendMessagePayload,
      TypingPayload,
      ChannelError,
    ],
  },
  (ctx) => {
    ctx.add(chatRoom);
  },
);

export default router;
