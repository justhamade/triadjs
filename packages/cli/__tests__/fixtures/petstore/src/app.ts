import { createRouter, endpoint, scenario, t } from '@triad/core';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name'),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

interface PetRepo {
  create(data: { name: string; species: string; age: number }): Promise<{
    id: string;
    name: string;
    species: 'dog' | 'cat' | 'bird' | 'fish';
    age: number;
  }>;
  findByName(name: string): Promise<unknown | null>;
  findById(id: string): Promise<unknown | null>;
}

declare module '@triad/core' {
  interface ServiceContainer {
    petRepo?: PetRepo;
  }
}

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    409: { schema: ApiError, description: 'Duplicate' },
  },
  handler: async (ctx) => {
    const existing = await ctx.services.petRepo!.findByName(ctx.body.name);
    if (existing) {
      return ctx.respond[409]({
        code: 'DUPLICATE',
        message: `Pet "${ctx.body.name}" already exists`,
      });
    }
    const pet = await ctx.services.petRepo!.create(ctx.body);
    return ctx.respond[201](pet as never);
  },
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),

    scenario('Duplicate pet names are rejected')
      .given('a pet named "Buddy" already exists')
      .setup(async (services) => {
        await services.petRepo!.create({ name: 'Buddy', species: 'dog', age: 3 });
      })
      .body({ name: 'Buddy', species: 'dog', age: 5 })
      .when('I create a pet')
      .then('response status is 409')
      .and('response body has code "DUPLICATE"'),
  ],
});

const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get a pet by ID',
  tags: ['Pets'],
  request: { params: { id: t.string() } },
  responses: {
    200: { schema: Pet, description: 'Found' },
    404: { schema: ApiError, description: 'Not found' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo!.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: 'Pet not found',
      });
    }
    return ctx.respond[200](pet as never);
  },
  behaviors: [
    scenario('Unknown IDs return 404')
      .given('no pet exists with id {petId}')
      .fixtures({ petId: 'missing' })
      .params({ id: '{petId}' })
      .when('I GET /pets/{petId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description: 'A fixture project used by @triad/cli integration tests.',
});

router.add(createPet, getPet);

export default router;
