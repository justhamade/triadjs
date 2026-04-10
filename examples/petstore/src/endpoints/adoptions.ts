/**
 * Adoption workflow endpoints.
 *
 * Demonstrates an operation that spans multiple aggregates — the adoption
 * request touches the pet repository (status change), the adopter
 * repository (lookup), and the adoption repository (new record). In a
 * production app this would likely be wrapped in a transaction or a
 * domain service; here we keep the handler thin so the example stays
 * readable.
 */

import { endpoint, scenario, t } from '@triad/core';
import {
  Adopter,
  Adoption,
  AdoptionRequest,
  CreateAdopter,
} from '../schemas/adoption.js';
import { ApiError } from '../schemas/common.js';

// ---------------------------------------------------------------------------
// POST /adopters — register an adopter
// ---------------------------------------------------------------------------

export const createAdopter = endpoint({
  name: 'createAdopter',
  method: 'POST',
  path: '/adopters',
  summary: 'Register a new adopter',
  tags: ['Adoption'],
  request: { body: CreateAdopter },
  responses: {
    201: { schema: Adopter, description: 'Adopter created' },
  },
  handler: async (ctx) => {
    const adopter = await ctx.services.adopterRepo.create(ctx.body);
    return ctx.respond[201](adopter);
  },
  behaviors: [
    scenario('Adopters can register with a name and email')
      .given('valid adopter details')
      .body({ name: 'Alice Example', email: 'alice@example.com' })
      .when('I register an adopter')
      .then('response status is 201')
      .and('response body matches Adopter')
      .and('response body has name "Alice Example"'),
  ],
});

// ---------------------------------------------------------------------------
// POST /pets/:id/adopt — request adoption
// ---------------------------------------------------------------------------

export const requestAdoption = endpoint({
  name: 'requestAdoption',
  method: 'POST',
  path: '/pets/:id/adopt',
  summary: 'Request to adopt a pet',
  description:
    'Creates an adoption record in "requested" state and marks the pet as pending. Fails if the pet is not available or already has an open request.',
  tags: ['Adoption'],
  request: {
    params: { id: t.string().format('uuid').doc('The pet ID') },
    body: AdoptionRequest,
  },
  responses: {
    201: { schema: Adoption, description: 'Adoption requested' },
    404: { schema: ApiError, description: 'Pet or adopter not found' },
    409: {
      schema: ApiError,
      description: 'Pet is not available for adoption',
    },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({
        code: 'PET_NOT_FOUND',
        message: `No pet with id ${ctx.params.id}.`,
      });
    }
    const adopter = await ctx.services.adopterRepo.findById(ctx.body.adopterId);
    if (!adopter) {
      return ctx.respond[404]({
        code: 'ADOPTER_NOT_FOUND',
        message: `No adopter with id ${ctx.body.adopterId}.`,
      });
    }
    if (pet.status !== 'available') {
      return ctx.respond[409]({
        code: 'PET_NOT_AVAILABLE',
        message: `Pet "${pet.name}" is not available for adoption (status: ${pet.status}).`,
      });
    }

    // Domain transition: mark the pet as pending and create the record.
    await ctx.services.petRepo.setStatus(pet.id, 'pending');
    const adoption = await ctx.services.adoptionRepo.request({
      petId: pet.id,
      adopterId: adopter.id,
      fee: pet.adoptionFee,
    });
    return ctx.respond[201](adoption);
  },
  behaviors: [
    scenario('Available pets can be adopted')
      .given('an available pet and a registered adopter')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        const adopter = await services.adopterRepo.create({
          name: 'Alice',
          email: 'alice@example.com',
        });
        return { petId: pet.id, adopterId: adopter.id };
      })
      .params({ id: '{petId}' })
      .body({ adopterId: '{adopterId}' })
      .when('I POST /pets/{petId}/adopt')
      .then('response status is 201')
      .and('response body matches Adoption'),

    scenario('Already-pending pets cannot be adopted again')
      .given('a pet that is already pending adoption')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        await services.petRepo.setStatus(pet.id, 'pending');
        const adopter = await services.adopterRepo.create({
          name: 'Alice',
          email: 'alice@example.com',
        });
        return { petId: pet.id, adopterId: adopter.id };
      })
      .params({ id: '{petId}' })
      .body({ adopterId: '{adopterId}' })
      .when('I POST /pets/{petId}/adopt')
      .then('response status is 409')
      .and('response body has code "PET_NOT_AVAILABLE"'),

    scenario('Unknown adopters are rejected')
      .given('an available pet but a missing adopter')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        return { petId: pet.id };
      })
      .params({ id: '{petId}' })
      .body({ adopterId: '00000000-0000-0000-0000-000000000000' })
      .when('I POST /pets/{petId}/adopt')
      .then('response status is 404')
      .and('response body has code "ADOPTER_NOT_FOUND"'),
  ],
});

// ---------------------------------------------------------------------------
// POST /adoptions/:id/complete — finalize adoption
// ---------------------------------------------------------------------------

export const completeAdoption = endpoint({
  name: 'completeAdoption',
  method: 'POST',
  path: '/adoptions/:id/complete',
  summary: 'Finalize an adoption',
  description:
    'Transitions a requested adoption to completed and marks the pet as adopted.',
  tags: ['Adoption'],
  request: {
    params: { id: t.string().format('uuid').doc('The adoption ID') },
  },
  responses: {
    200: { schema: Adoption, description: 'Adoption completed' },
    404: { schema: ApiError, description: 'Adoption not found' },
    409: {
      schema: ApiError,
      description: 'Adoption is not in a requestable state',
    },
  },
  handler: async (ctx) => {
    const adoption = await ctx.services.adoptionRepo.findById(ctx.params.id);
    if (!adoption) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No adoption with id ${ctx.params.id}.`,
      });
    }
    if (adoption.status !== 'requested') {
      return ctx.respond[409]({
        code: 'INVALID_STATE',
        message: `Adoption is ${adoption.status}, not requested.`,
      });
    }
    const completed = await ctx.services.adoptionRepo.complete(adoption.id);
    await ctx.services.petRepo.setStatus(adoption.petId, 'adopted');
    return ctx.respond[200](completed!);
  },
  behaviors: [
    scenario('Requested adoptions can be completed')
      .given('an adoption in requested state')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        await services.petRepo.setStatus(pet.id, 'pending');
        const adopter = await services.adopterRepo.create({
          name: 'Alice',
          email: 'alice@example.com',
        });
        const adoption = await services.adoptionRepo.request({
          petId: pet.id,
          adopterId: adopter.id,
          fee: pet.adoptionFee,
        });
        return { adoptionId: adoption.id };
      })
      .params({ id: '{adoptionId}' })
      .when('I POST /adoptions/{adoptionId}/complete')
      .then('response status is 200')
      .and('response body matches Adoption')
      .and('response body has status "completed"'),

    scenario('Unknown adoption IDs return 404')
      .given('no adoption exists with id {adoptionId}')
      .fixtures({ adoptionId: '00000000-0000-0000-0000-000000000000' })
      .params({ id: '{adoptionId}' })
      .when('I POST /adoptions/{adoptionId}/complete')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});
