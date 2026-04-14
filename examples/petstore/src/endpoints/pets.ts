/**
 * Pet CRUD endpoints.
 *
 * Every endpoint in this file follows the same shape: a declarative
 * `endpoint()` configuration with `request` schemas, typed `responses`,
 * a thin `handler` that delegates to the repository, and a `behaviors`
 * array that doubles as documentation and tests.
 *
 * Notice what the handler does NOT contain:
 *   - Input validation (the schema does it)
 *   - Output validation (ctx.respond does it)
 *   - Type annotations on ctx.* (inference does it)
 *   - Error handling for unknown fields (the schema rejects them)
 *
 * The handler is almost purely "map API input to repository call and
 * back". That is the single-source-of-truth payoff.
 */

import { endpoint, scenario, t } from '@triadjs/core';
import { Pet, CreatePet, UpdatePet } from '../schemas/pet.js';
import { ApiError } from '../schemas/common.js';

// ---------------------------------------------------------------------------
// POST /pets — create
// ---------------------------------------------------------------------------

export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  description: 'Adds a new pet to the store. Pet names must be unique within a species.',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Pet created successfully' },
    409: { schema: ApiError, description: 'A pet with the same name already exists' },
  },
  handler: async (ctx) => {
    const existing = await ctx.services.petRepo.findByNameAndSpecies(
      ctx.body.name,
      ctx.body.species,
    );
    if (existing) {
      return ctx.respond[409]({
        code: 'DUPLICATE_PET',
        message: `A ${ctx.body.species} named "${ctx.body.name}" already exists.`,
      });
    }
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),

    scenario('Pet names must be unique within the same species')
      .given('a dog named "Buddy" already exists')
      .setup(async (services) => {
        await services.petRepo.create({ name: 'Buddy', species: 'dog', age: 3 });
      })
      .body({ name: 'Buddy', species: 'dog', age: 5 })
      .when('I create a pet')
      .then('response status is 409')
      .and('response body has code "DUPLICATE_PET"'),

    scenario('The same name is allowed across different species')
      .given('a dog named "Whiskers" already exists')
      .setup(async (services) => {
        await services.petRepo.create({ name: 'Whiskers', species: 'dog', age: 4 });
      })
      .body({ name: 'Whiskers', species: 'cat', age: 2 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body has species "cat"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /pets/:id — read one
// ---------------------------------------------------------------------------

export const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get a pet by ID',
  tags: ['Pets'],
  request: {
    params: { id: t.string().format('uuid').doc('The pet ID') },
  },
  responses: {
    200: { schema: Pet, description: 'Pet found' },
    404: { schema: ApiError, description: 'Pet not found' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No pet with id ${ctx.params.id}.`,
      });
    }
    return ctx.respond[200](pet);
  },
  behaviors: [
    scenario('Existing pets can be retrieved by ID')
      .given('a pet exists with id {petId}')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        return { petId: pet.id };
      })
      .params({ id: '{petId}' })
      .when('I GET /pets/{petId}')
      .then('response status is 200')
      .and('response body has name "Rex"')
      .and('response body has id "{petId}"'),

    scenario('Non-existent pet IDs return 404')
      .given('no pet exists with id {petId}')
      .fixtures({ petId: '00000000-0000-0000-0000-000000000000' })
      .params({ id: '{petId}' })
      .when('I GET /pets/{petId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /pets — list with filters
// ---------------------------------------------------------------------------

export const listPets = endpoint({
  name: 'listPets',
  method: 'GET',
  path: '/pets',
  summary: 'List pets with optional filters',
  tags: ['Pets'],
  request: {
    query: {
      species: t
        .enum('dog', 'cat', 'bird', 'fish')
        .optional()
        .doc('Filter by species'),
      status: t
        .enum('available', 'adopted', 'pending')
        .optional()
        .doc('Filter by adoption status'),
      limit: t.int32().min(1).max(100).default(20).doc('Page size'),
      offset: t.int32().min(0).default(0).doc('Page offset'),
    },
  },
  responses: {
    200: { schema: t.array(Pet), description: 'List of pets' },
  },
  handler: async (ctx) => {
    const pets = await ctx.services.petRepo.list({
      limit: ctx.query.limit,
      offset: ctx.query.offset,
      ...(ctx.query.species !== undefined && { species: ctx.query.species }),
      ...(ctx.query.status !== undefined && { status: ctx.query.status }),
    });
    return ctx.respond[200](pets);
  },
  behaviors: [
    scenario('All pets are returned when no filters apply')
      .given('two pets exist')
      .setup(async (services) => {
        await services.petRepo.create({ name: 'Rex', species: 'dog', age: 5 });
        await services.petRepo.create({ name: 'Whiskers', species: 'cat', age: 3 });
      })
      .when('I list all pets')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 2'),

    scenario('Pets can be filtered by species')
      .given('pets of multiple species exist')
      .setup(async (services) => {
        await services.petRepo.create({ name: 'Rex', species: 'dog', age: 5 });
        await services.petRepo.create({ name: 'Buddy', species: 'dog', age: 2 });
        await services.petRepo.create({ name: 'Whiskers', species: 'cat', age: 3 });
      })
      .query({ species: 'dog' })
      .when('I list pets filtered by species dog')
      .then('response status is 200')
      .and('response body has length 2'),
  ],
});

// ---------------------------------------------------------------------------
// PATCH /pets/:id — update
// ---------------------------------------------------------------------------

export const updatePet = endpoint({
  name: 'updatePet',
  method: 'PATCH',
  path: '/pets/:id',
  summary: 'Update mutable fields on a pet',
  tags: ['Pets'],
  request: {
    params: { id: t.string().format('uuid') },
    body: UpdatePet,
  },
  responses: {
    200: { schema: Pet, description: 'Pet updated' },
    404: { schema: ApiError, description: 'Pet not found' },
  },
  handler: async (ctx) => {
    const updated = await ctx.services.petRepo.update(ctx.params.id, ctx.body);
    if (!updated) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No pet with id ${ctx.params.id}.`,
      });
    }
    return ctx.respond[200](updated);
  },
  behaviors: [
    scenario('Existing pets can be updated')
      .given('a pet exists with id {petId}')
      .setup(async (services) => {
        const pet = await services.petRepo.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        return { petId: pet.id };
      })
      .params({ id: '{petId}' })
      .body({ age: 6 })
      .when('I PATCH /pets/{petId}')
      .then('response status is 200')
      .and('response body has age 6'),
  ],
});
