import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { channel, createRouter, endpoint, scenario, t } from '@triad/core';
import { generateGherkin, toKebabCase } from '../src/generator.js';
import { writeGherkinFiles } from '../src/writer.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');
const ApiError = t.model('ApiError', { code: t.string(), message: t.string() });

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    400: { schema: ApiError, description: 'Invalid' },
  },
  handler: async (ctx) =>
    ctx.respond[201]({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: ctx.body.name,
      species: ctx.body.species,
      age: ctx.body.age,
    }),
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),

    scenario('Missing required fields return a validation error')
      .given('a pet payload with missing name')
      .body({ species: 'cat', age: 2 })
      .when('I create a pet')
      .then('response status is 400')
      .and('response body has code "VALIDATION_ERROR"'),
  ],
});

const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get a pet',
  tags: ['Pets'],
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    200: { schema: Pet, description: 'Found' },
    404: { schema: ApiError, description: 'Missing' },
  },
  handler: async (ctx) =>
    ctx.respond[200]({
      id: ctx.params.id,
      name: 'Buddy',
      species: 'dog' as const,
      age: 3,
    }),
  behaviors: [
    scenario('Existing pets can be retrieved by ID')
      .given('a pet exists with id {petId}')
      .when('I GET /pets/{petId}')
      .then('response status is 200')
      .and('response body has name "Buddy"'),

    scenario('Non-existent pet IDs return 404')
      .given('no pet exists with id {petId}')
      .fixtures({ petId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /pets/{petId}')
      .then('response status is 404'),
  ],
});

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

describe('toKebabCase', () => {
  it('lowercases single words', () => {
    expect(toKebabCase('Pets')).toBe('pets');
  });

  it('converts PascalCase to kebab-case', () => {
    expect(toKebabCase('AdoptionLifecycle')).toBe('adoption-lifecycle');
  });

  it('converts spaces and underscores to hyphens', () => {
    expect(toKebabCase('Pet Store Orders')).toBe('pet-store-orders');
    expect(toKebabCase('pet_store_orders')).toBe('pet-store-orders');
  });

  it('collapses consecutive separators', () => {
    expect(toKebabCase('a__b  c')).toBe('a-b-c');
  });
});

// ---------------------------------------------------------------------------
// generateGherkin — grouping
// ---------------------------------------------------------------------------

describe('generateGherkin — grouping', () => {
  it('groups endpoints by their first tag when no bounded context is declared', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.add(createPet, getPet);
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Pets');
    expect(files[0]?.filename).toBe('pets.feature');
  });

  it('groups endpoints by bounded context when present', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'Adoption',
      { description: 'Manages the pet adoption lifecycle' },
      (ctx) => {
        ctx.add(createPet, getPet);
      },
    );
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Adoption');
    expect(files[0]?.filename).toBe('adoption.feature');
  });

  it('emits the bounded context description as Feature description', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'Adoption',
      { description: 'Manages the pet adoption lifecycle' },
      (ctx) => ctx.add(createPet),
    );
    const files = generateGherkin(router);
    expect(files[0]?.content).toContain(
      'Feature: Adoption\n\n  Manages the pet adoption lifecycle',
    );
  });

  it('creates an "Other" feature for endpoints with no tags and no context', () => {
    const untagged = endpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      summary: 'Ping',
      responses: { 200: { schema: t.string(), description: 'pong' } },
      handler: async (ctx) => ctx.respond[200]('pong'),
      behaviors: [
        scenario('Ping returns 200')
          .given('the service is up')
          .when('I GET /ping')
          .then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(untagged);
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Other');
    expect(files[0]?.filename).toBe('other.feature');
  });

  it('skips endpoints that have no behaviors', () => {
    const noBehaviors = endpoint({
      name: 'health',
      method: 'GET',
      path: '/health',
      summary: 'Health',
      tags: ['Health'],
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(noBehaviors);
    const files = generateGherkin(router);
    expect(files).toHaveLength(0);
  });

  it('returns contexts in declaration order, then tags alphabetically, then Other', () => {
    const untagged = endpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      summary: 'Ping',
      responses: { 200: { schema: t.string(), description: 'pong' } },
      handler: async (ctx) => ctx.respond[200]('pong'),
      behaviors: [
        scenario('Ping ok').given('up').when('GET').then('response status is 200'),
      ],
    });
    const adminEndpoint = endpoint({
      name: 'admin',
      method: 'GET',
      path: '/admin',
      summary: 'Admin',
      tags: ['Admin'],
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
      behaviors: [
        scenario('Admin ok').given('up').when('GET').then('response status is 200'),
      ],
    });

    const router = createRouter({ title: 'x', version: '1' });
    router.context('ZebraContext', {}, (ctx) => ctx.add(createPet));
    router.add(adminEndpoint); // tag: Admin
    router.add(getPet); // tag: Pets
    router.add(untagged); // no tag → Other

    const names = generateGherkin(router).map((f) => f.name);
    expect(names).toEqual(['ZebraContext', 'Admin', 'Pets', 'Other']);
  });

  it('multiple contexts each produce their own feature file', () => {
    const inventoryEndpoint = endpoint({
      name: 'listInventory',
      method: 'GET',
      path: '/inventory',
      summary: 'List inventory',
      responses: { 200: { schema: t.array(t.string()), description: 'List' } },
      handler: async (ctx) => ctx.respond[200]([]),
      behaviors: [
        scenario('Inventory list works')
          .given('items exist')
          .when('I GET /inventory')
          .then('response status is 200'),
      ],
    });

    const router = createRouter({ title: 'x', version: '1' });
    router.context('Adoption', {}, (ctx) => ctx.add(createPet, getPet));
    router.context('Inventory', {}, (ctx) => ctx.add(inventoryEndpoint));

    const files = generateGherkin(router);
    expect(files.map((f) => f.name)).toEqual(['Adoption', 'Inventory']);
  });
});

// ---------------------------------------------------------------------------
// generateGherkin — full content
// ---------------------------------------------------------------------------

describe('generateGherkin — full feature content', () => {
  it('matches the spec example for a Pets feature', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.add(createPet, getPet);
    const files = generateGherkin(router);
    const content = files[0]?.content ?? '';

    // Headline
    expect(content).toMatch(/^Feature: Pets\n/);

    // Each scenario title present
    expect(content).toContain('Scenario: Pets can be created with valid data');
    expect(content).toContain('Scenario: Missing required fields return a validation error');
    expect(content).toContain('Scenario: Existing pets can be retrieved by ID');
    expect(content).toContain('Scenario: Non-existent pet IDs return 404');

    // Given/When/Then steps present
    expect(content).toContain('Given a valid pet payload');
    expect(content).toContain('When I create a pet');
    expect(content).toContain('Then response status is 201');
    expect(content).toContain('And response body matches Pet');
    expect(content).toContain('And response body has name "Buddy"');

    // Data table from body
    expect(content).toContain('| field   | value |');
    expect(content).toContain('| name    | Buddy |');

    // File ends with a newline
    expect(content.endsWith('\n')).toBe(true);
  });

  it('separates scenarios with a blank line', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.add(createPet);
    const content = generateGherkin(router)[0]?.content ?? '';
    // Between "Scenario: Pets can be created..." and "Scenario: Missing..."
    expect(content).toMatch(/has name "Buddy"\n\n  Scenario: Missing/);
  });

  it('does not render params/fixtures/setup as Gherkin steps', () => {
    const router = createRouter({ title: 'x', version: '1' });
    router.add(getPet);
    const content = generateGherkin(router)[0]?.content ?? '';
    expect(content).not.toContain('00000000-0000-0000-0000-000000000000'); // fixture
    expect(content).not.toContain('Bearer'); // header
    expect(content).not.toContain('setup'); // function name
  });
});

// ---------------------------------------------------------------------------
// writeGherkinFiles
// ---------------------------------------------------------------------------

describe('writeGherkinFiles', () => {
  it('writes each file to the output directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-gherkin-'));
    try {
      const router = createRouter({ title: 'x', version: '1' });
      router.add(createPet, getPet);
      const files = generateGherkin(router);
      const written = writeGherkinFiles(files, tmp);

      expect(written).toHaveLength(1);
      const content = fs.readFileSync(path.join(tmp, 'pets.feature'), 'utf8');
      expect(content).toContain('Feature: Pets');
      expect(content).toContain('Scenario: Pets can be created with valid data');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('creates the output directory if it does not exist', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'triad-gherkin-'));
    const outDir = path.join(parent, 'nested', 'features');
    try {
      const router = createRouter({ title: 'x', version: '1' });
      router.add(createPet);
      writeGherkinFiles(generateGherkin(router), outDir);
      expect(fs.existsSync(outDir)).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'pets.feature'))).toBe(true);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// generateGherkin — channels
// ---------------------------------------------------------------------------

const ChatMessagePayload = t.model('ChatMessagePayload', {
  text: t.string().minLength(1),
});

const ChatMessage = t.model('ChatMessage', {
  id: t.string(),
  text: t.string(),
});

function makeChatChannel(): ReturnType<typeof channel> {
  return channel({
    name: 'chatRoom',
    path: '/ws/rooms/:roomId',
    summary: 'Real-time chat room',
    tags: ['Chat'],
    connection: {
      params: { roomId: t.string().format('uuid') },
    },
    clientMessages: {
      sendMessage: {
        schema: ChatMessagePayload,
        description: 'Send a message',
      },
    },
    serverMessages: {
      message: { schema: ChatMessage, description: 'New message' },
    },
    handlers: {
      sendMessage: async () => {},
    },
    behaviors: [
      scenario('Users can post messages to a room they have joined')
        .given('alice is connected to the chat room')
        .body({ text: 'Hello everyone' })
        .when('alice sends sendMessage')
        .then('alice receives a message event')
        .and('alice receives a message with text "Hello everyone"'),

      scenario('Typing does not echo back to the sender')
        .given('alice and bob are connected')
        .when('alice sends typing')
        .then('bob receives a typing event')
        .and('alice does not receive a typing event'),
    ],
  });
}

describe('generateGherkin — channels', () => {
  it('emits a scenario per channel behavior as part of the feature file', () => {
    const chat = makeChatChannel();
    const router = createRouter({ title: 'x', version: '1' });
    router.add(chat);
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Chat');
    expect(files[0]?.filename).toBe('chat.feature');

    const content = files[0]?.content ?? '';
    expect(content).toContain('Feature: Chat');
    expect(content).toContain(
      'Scenario: Users can post messages to a room they have joined',
    );
    expect(content).toContain('Given alice is connected to the chat room');
    expect(content).toContain('When alice sends sendMessage');
    expect(content).toContain('Then alice receives a message event');
    expect(content).toContain(
      'And alice receives a message with text "Hello everyone"',
    );
    expect(content).toContain('And alice does not receive a typing event');
  });

  it('groups channels under their bounded context', () => {
    const chat = makeChatChannel();
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'Messaging',
      { description: 'Real-time chat' },
      (ctx) => ctx.add(chat),
    );
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Messaging');
    expect(files[0]?.content).toContain('Feature: Messaging');
    expect(files[0]?.content).toContain('Real-time chat');
    expect(files[0]?.content).toContain(
      'Scenario: Users can post messages to a room they have joined',
    );
  });

  it('places untagged channels in the Other feature', () => {
    const untagged = channel({
      name: 'ping',
      path: '/ws/ping',
      summary: 'Ping',
      clientMessages: {
        ping: { schema: t.model('PingPayload', {}), description: 'ping' },
      },
      serverMessages: {
        pong: { schema: t.model('PongPayload', {}), description: 'pong' },
      },
      handlers: { ping: async () => {} },
      behaviors: [
        scenario('Ping responds with pong')
          .given('a connected client')
          .when('client sends ping')
          .then('client receives a pong event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(untagged);
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('Other');
    expect(files[0]?.content).toContain('Scenario: Ping responds with pong');
  });

  it('skips channels that have no behaviors', () => {
    const silent = channel({
      name: 'silent',
      path: '/ws/silent',
      summary: 'Silent',
      tags: ['Silent'],
      clientMessages: {
        noop: { schema: t.model('NoopPayload', {}), description: 'noop' },
      },
      serverMessages: {
        ack: { schema: t.model('AckPayload', {}), description: 'ack' },
      },
      handlers: { noop: async () => {} },
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(silent);
    expect(generateGherkin(router)).toHaveLength(0);
  });

  it('mixes HTTP endpoints and channels in one feature when they share a context, endpoints first', () => {
    const chat = makeChatChannel();
    const router = createRouter({ title: 'x', version: '1' });
    router.context('Chat', {}, (ctx) => {
      ctx.add(createPet, chat);
    });
    const files = generateGherkin(router);
    expect(files).toHaveLength(1);
    const content = files[0]?.content ?? '';

    const petsIdx = content.indexOf(
      'Scenario: Pets can be created with valid data',
    );
    const chatIdx = content.indexOf(
      'Scenario: Users can post messages to a room they have joined',
    );
    expect(petsIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeGreaterThan(-1);
    expect(petsIdx).toBeLessThan(chatIdx);
  });

  it('produces a separate feature file per tag for HTTP + channels with different tags', () => {
    const chat = makeChatChannel();
    const router = createRouter({ title: 'x', version: '1' });
    router.add(createPet, chat);
    const files = generateGherkin(router);
    expect(files.map((f) => f.name).sort()).toEqual(['Chat', 'Pets']);
  });

  it('orders contexts in declaration order, tags alphabetically, Other last — with channels mixed in', () => {
    const chat = makeChatChannel(); // tag: Chat
    const untagged = channel({
      name: 'ping',
      path: '/ws/ping',
      summary: 'Ping',
      clientMessages: {
        ping: { schema: t.model('PingPayload2', {}), description: 'ping' },
      },
      serverMessages: {
        pong: { schema: t.model('PongPayload2', {}), description: 'pong' },
      },
      handlers: { ping: async () => {} },
      behaviors: [
        scenario('Ping ok')
          .given('x')
          .when('client sends ping')
          .then('client receives a pong event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.context('ZebraContext', {}, (ctx) => ctx.add(createPet));
    router.add(chat); // tag: Chat
    router.add(getPet); // tag: Pets
    router.add(untagged); // no tag → Other
    const names = generateGherkin(router).map((f) => f.name);
    expect(names).toEqual(['ZebraContext', 'Chat', 'Pets', 'Other']);
  });
});
