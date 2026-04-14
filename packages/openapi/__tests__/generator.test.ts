import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, scenario, t } from '@triadjs/core';
import { generateOpenAPI, convertPath } from '../src/generator.js';
import { toYaml, toJson } from '../src/serialize.js';

// ---------------------------------------------------------------------------
// Shared test fixtures — a small Petstore
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name').example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years'),
  status: t
    .enum('available', 'adopted', 'pending')
    .doc('Adoption status')
    .default('available'),
  tags: t.array(t.string()).optional().doc('Searchable tags'),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const ApiError = t.model('ApiError', {
  code: t.string().doc('Error code'),
  message: t.string().doc('Human-readable message'),
});

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  description: 'Add a new pet to the store',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Pet created' },
    400: { schema: ApiError, description: 'Validation error' },
  },
  handler: async (ctx) =>
    ctx.respond[201]({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: ctx.body.name,
      species: ctx.body.species,
      age: ctx.body.age,
      status: 'available' as const,
    }),
  behaviors: [
    scenario('Pets can be created')
      .given('a valid payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201'),
  ],
});

const getPet = endpoint({
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
  handler: async (ctx) =>
    ctx.respond[200]({
      id: ctx.params.id,
      name: 'Buddy',
      species: 'dog' as const,
      age: 3,
      status: 'available' as const,
    }),
});

const listPets = endpoint({
  name: 'listPets',
  method: 'GET',
  path: '/pets',
  summary: 'List all pets',
  tags: ['Pets'],
  request: {
    query: {
      species: t.enum('dog', 'cat', 'bird', 'fish').optional().doc('Filter by species'),
      limit: t.int32().min(1).max(100).default(20).doc('Page size'),
      offset: t.int32().min(0).default(0).doc('Page offset'),
    },
    headers: {
      authorization: t.string().doc('Bearer token'),
    },
  },
  responses: {
    200: { schema: t.array(Pet), description: 'List of pets' },
  },
  handler: async (ctx) => ctx.respond[200]([]),
});

function buildRouter() {
  const router = createRouter({
    title: 'Petstore API',
    version: '1.0.0',
    description: 'A sample Triad API',
    servers: [{ url: 'https://api.example.com', description: 'Production' }],
  });
  router.add(createPet, getPet, listPets);
  return router;
}

// ---------------------------------------------------------------------------
// convertPath
// ---------------------------------------------------------------------------

describe('convertPath', () => {
  it('converts :id → {id}', () => {
    expect(convertPath('/pets/:id')).toBe('/pets/{id}');
  });

  it('converts multiple params', () => {
    expect(convertPath('/users/:userId/pets/:petId')).toBe('/users/{userId}/pets/{petId}');
  });

  it('leaves paths without params untouched', () => {
    expect(convertPath('/pets')).toBe('/pets');
  });

  it('handles underscores and digits in param names', () => {
    expect(convertPath('/v1/pets/:pet_id_2')).toBe('/v1/pets/{pet_id_2}');
  });
});

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------

describe('generateOpenAPI — document structure', () => {
  const doc = generateOpenAPI(buildRouter());

  it('emits OpenAPI 3.1.0', () => {
    expect(doc.openapi).toBe('3.1.0');
  });

  it('populates info from router config', () => {
    expect(doc.info).toEqual({
      title: 'Petstore API',
      version: '1.0.0',
      description: 'A sample Triad API',
    });
  });

  it('populates servers from router config', () => {
    expect(doc.servers).toEqual([
      { url: 'https://api.example.com', description: 'Production' },
    ]);
  });

  it('registers all endpoints as paths with correct methods', () => {
    expect(doc.paths['/pets']?.post?.operationId).toBe('createPet');
    expect(doc.paths['/pets']?.get?.operationId).toBe('listPets');
    expect(doc.paths['/pets/{id}']?.get?.operationId).toBe('getPet');
  });

  it('converts Express-style path params to OpenAPI format', () => {
    expect(doc.paths['/pets/{id}']).toBeDefined();
    expect(doc.paths['/pets/:id']).toBeUndefined();
  });

  it('registers named models in components/schemas', () => {
    expect(doc.components.schemas['Pet']).toBeDefined();
    expect(doc.components.schemas['CreatePet']).toBeDefined();
    expect(doc.components.schemas['ApiError']).toBeDefined();
  });

  it('collects endpoint tags at the top level', () => {
    expect(doc.tags).toContainEqual({ name: 'Pets' });
  });
});

// ---------------------------------------------------------------------------
// Operation details
// ---------------------------------------------------------------------------

describe('generateOpenAPI — operation details', () => {
  const doc = generateOpenAPI(buildRouter());

  it('createPet has requestBody referencing CreatePet', () => {
    const op = doc.paths['/pets']?.post;
    expect(op?.requestBody?.required).toBe(true);
    const bodySchema = op?.requestBody?.content['application/json']?.schema;
    expect(bodySchema).toEqual({ $ref: '#/components/schemas/CreatePet' });
  });

  it('createPet responses reference Pet and ApiError', () => {
    const op = doc.paths['/pets']?.post;
    expect(op?.responses['201']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/Pet',
    });
    expect(op?.responses['400']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ApiError',
    });
  });

  it('response descriptions are preserved', () => {
    const op = doc.paths['/pets']?.post;
    expect(op?.responses['201']?.description).toBe('Pet created');
    expect(op?.responses['400']?.description).toBe('Validation error');
  });

  it('response status codes are sorted numerically', () => {
    const op = doc.paths['/pets']?.post;
    expect(Object.keys(op?.responses ?? {})).toEqual(['201', '400']);
  });

  it('getPet has a required path parameter', () => {
    const op = doc.paths['/pets/{id}']?.get;
    const idParam = op?.parameters?.find((p) => p.name === 'id');
    expect(idParam).toBeDefined();
    expect(idParam?.in).toBe('path');
    expect(idParam?.required).toBe(true);
    expect(idParam?.description).toBe('The pet ID');
    expect(idParam?.schema).toMatchObject({ type: 'string', format: 'uuid' });
  });

  it('listPets has query parameters with correct required flags', () => {
    const op = doc.paths['/pets']?.get;
    const params = op?.parameters ?? [];

    const speciesParam = params.find((p) => p.name === 'species');
    expect(speciesParam?.required).toBeUndefined(); // optional
    expect(speciesParam?.in).toBe('query');

    const limitParam = params.find((p) => p.name === 'limit');
    expect(limitParam?.required).toBeUndefined(); // has default
    expect(limitParam?.schema).toMatchObject({
      type: 'integer',
      format: 'int32',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
  });

  it('listPets has a required header parameter', () => {
    const op = doc.paths['/pets']?.get;
    const authParam = op?.parameters?.find((p) => p.name === 'authorization');
    expect(authParam?.in).toBe('header');
    expect(authParam?.required).toBe(true);
  });

  it('200 response with array schema emits array of $ref', () => {
    const op = doc.paths['/pets']?.get;
    const schema = op?.responses['200']?.content?.['application/json']?.schema;
    expect(schema).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/Pet' },
    });
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('generateOpenAPI — components/schemas', () => {
  const doc = generateOpenAPI(buildRouter());

  it('Pet component has properties and required list', () => {
    const pet = doc.components.schemas['Pet']!;
    expect(pet.type).toBe('object');
    expect(pet.title).toBe('Pet');
    expect(pet.properties?.id).toMatchObject({
      type: 'string',
      format: 'uuid',
      'x-triad-identity': 'true',
    });
    // status has a default so it's not required
    expect(pet.required).not.toContain('status');
    // tags is optional
    expect(pet.required).not.toContain('tags');
    // id, name, species, age are required
    expect(pet.required).toEqual(expect.arrayContaining(['id', 'name', 'species', 'age']));
  });

  it('CreatePet component only has picked fields', () => {
    const createPet = doc.components.schemas['CreatePet']!;
    expect(Object.keys(createPet.properties ?? {}).sort()).toEqual(['age', 'name', 'species']);
  });

  it('field descriptions propagate to component properties', () => {
    const pet = doc.components.schemas['Pet']!;
    expect(pet.properties?.name?.description).toBe('Pet name');
    expect(pet.properties?.age?.description).toBe('Age in years');
  });

  it('examples propagate', () => {
    const pet = doc.components.schemas['Pet']!;
    expect(pet.properties?.name?.example).toBe('Buddy');
  });
});

// ---------------------------------------------------------------------------
// Bounded contexts → tags
// ---------------------------------------------------------------------------

describe('generateOpenAPI — bounded contexts', () => {
  it('context descriptions become top-level tag descriptions', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'Adoption',
      { description: 'Manages the pet adoption lifecycle', models: [Pet] },
      (ctx) => {
        ctx.add(createPet);
      },
    );
    const doc = generateOpenAPI(router);
    expect(doc.tags).toContainEqual({
      name: 'Adoption',
      description: 'Manages the pet adoption lifecycle',
    });
  });

  it('endpoints in a context are auto-tagged with the context name', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context('Adoption', {}, (ctx) => ctx.add(createPet));
    const doc = generateOpenAPI(router);
    const op = doc.paths['/pets']?.post;
    expect(op?.tags).toContain('Adoption');
    expect(op?.tags).toContain('Pets'); // declared tag still present
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('serialize — YAML and JSON', () => {
  const doc = generateOpenAPI(buildRouter());

  it('toYaml produces OpenAPI-compatible YAML', () => {
    const yaml = toYaml(doc);
    expect(yaml).toContain('openapi: 3.1.0');
    expect(yaml).toContain('title: Petstore API');
    expect(yaml).toContain('/pets:');
    expect(yaml).toContain('$ref: "#/components/schemas/Pet"');
  });

  it('toJson produces valid JSON', () => {
    const json = toJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toBe('Petstore API');
  });

  it('toJson round-trips through parse', () => {
    const json = toJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(doc);
  });
});

// ---------------------------------------------------------------------------
// t.empty() — content field is omitted for empty responses
// ---------------------------------------------------------------------------

describe('generateOpenAPI — t.empty() responses', () => {
  const deletePet = endpoint({
    name: 'deletePet',
    method: 'DELETE',
    path: '/pets/:id',
    summary: 'Delete a pet',
    tags: ['Pets'],
    request: { params: { id: t.string().format('uuid') } },
    responses: {
      204: { schema: t.empty(), description: 'Pet deleted' },
      404: { schema: ApiError, description: 'Not found' },
    },
    handler: async (ctx) => {
      if (ctx.params.id === 'missing') {
        return ctx.respond[404]({ code: 'NOT_FOUND', message: 'x' });
      }
      return ctx.respond[204]();
    },
  });

  function docWithDelete() {
    const router = createRouter({ title: 'Petstore', version: '1.0.0' });
    router.add(createPet, deletePet);
    return generateOpenAPI(router);
  }

  it('204 response has a description but no content field', () => {
    const doc = docWithDelete();
    const op = doc.paths['/pets/{id}']?.delete;
    expect(op?.responses['204']).toBeDefined();
    expect(op?.responses['204']?.description).toBe('Pet deleted');
    expect(op?.responses['204']?.content).toBeUndefined();
  });

  it('non-empty responses on the same operation still have content', () => {
    const doc = docWithDelete();
    const op = doc.paths['/pets/{id}']?.delete;
    expect(op?.responses['404']?.content).toBeDefined();
    expect(op?.responses['404']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ApiError',
    });
  });

  it('a 200 response on a different endpoint still has content (unaffected)', () => {
    const doc = docWithDelete();
    const op = doc.paths['/pets']?.post;
    expect(op?.responses['201']?.content).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// File upload / multipart support
// ---------------------------------------------------------------------------

describe('file upload / multipart', () => {
  const Upload = t.model('AvatarUpload', {
    name: t.string().doc('Display name'),
    avatar: t.file().maxSize(5_000_000).mimeTypes('image/png', 'image/jpeg'),
  });

  const uploadAvatar = endpoint({
    name: 'uploadAvatar',
    method: 'POST',
    path: '/avatars',
    summary: 'Upload an avatar image',
    request: { body: Upload },
    responses: {
      201: {
        schema: t.model('AvatarOk', { url: t.string() }),
        description: 'Uploaded',
      },
    },
    handler: async (ctx) => ctx.respond[201]({ url: `/a/${ctx.body.name}` }),
  });

  function buildDoc() {
    const router = createRouter({ title: 'Uploads', version: '1.0.0' });
    router.add(uploadAvatar);
    return generateOpenAPI(router);
  }

  it('emits multipart/form-data content type for file-bearing bodies', () => {
    const doc = buildDoc();
    const op = doc.paths['/avatars']?.post;
    expect(op?.requestBody).toBeDefined();
    expect(op?.requestBody?.content['multipart/form-data']).toBeDefined();
    expect(op?.requestBody?.content['application/json']).toBeUndefined();
  });

  it('emits string/binary for file fields in the component schema', () => {
    const doc = buildDoc();
    const component = doc.components.schemas['AvatarUpload'];
    expect(component?.properties?.['avatar']).toMatchObject({
      type: 'string',
      format: 'binary',
    });
  });

  it('strips the internal __file marker from the final output', () => {
    const doc = buildDoc();
    const json = JSON.stringify(doc);
    expect(json).not.toContain('__file');
  });

  it('non-file bodies still emit application/json', () => {
    const plain = t.model('Plain', { name: t.string() });
    const ep = endpoint({
      name: 'postPlain',
      method: 'POST',
      path: '/plain',
      summary: 'Plain POST',
      request: { body: plain },
      responses: {
        200: { schema: t.model('Ok', { ok: t.boolean() }), description: 'ok' },
      },
      handler: async (ctx) => ctx.respond[200]({ ok: !!ctx.body.name }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const doc = generateOpenAPI(router);
    const op = doc.paths['/plain']?.post;
    expect(op?.requestBody?.content['application/json']).toBeDefined();
    expect(op?.requestBody?.content['multipart/form-data']).toBeUndefined();
  });

  it('mixed multipart bodies preserve non-file fields alongside files', () => {
    const doc = buildDoc();
    const component = doc.components.schemas['AvatarUpload'];
    expect(component?.properties?.['name']?.type).toBe('string');
    expect(component?.properties?.['avatar']?.format).toBe('binary');
    expect(component?.required).toContain('avatar');
  });
});
