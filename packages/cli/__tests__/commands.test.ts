/**
 * Integration tests for the four CLI commands.
 *
 * Each test runs a command against the fixture petstore project at
 * `__tests__/fixtures/petstore/` and asserts on the files it wrote, the
 * output it printed, or the exception it threw. The fixture uses jiti via
 * `loadConfig` / `loadRouter`, so this exercises the real TypeScript
 * config/router loading pipeline.
 *
 * `process.stdout.write` is temporarily redirected into a buffer for each
 * test so we can inspect command output without touching the terminal.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDocs } from '../src/commands/docs.js';
import { runGherkin } from '../src/commands/gherkin.js';
import { runTest } from '../src/commands/test.js';
import { runValidate } from '../src/commands/validate.js';
import { CliError } from '../src/errors.js';

const FIXTURE_DIR = fileURLToPath(
  new URL('./fixtures/petstore/', import.meta.url),
);
const CONFIG_PATH = path.join(FIXTURE_DIR, 'triad.config.ts');
const GENERATED_DIR = path.join(FIXTURE_DIR, 'generated');

function cleanGenerated(): void {
  if (fs.existsSync(GENERATED_DIR)) {
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
  }
}

interface OutputCapture {
  stdout: string;
  restore: () => void;
}

function captureOutput(): OutputCapture {
  const cap: OutputCapture = {
    stdout: '',
    restore: () => {},
  };
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    cap.stdout +=
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  cap.restore = () => {
    process.stdout.write = originalWrite;
  };
  return cap;
}

beforeEach(cleanGenerated);
afterEach(cleanGenerated);

// ---------------------------------------------------------------------------
// triad docs
// ---------------------------------------------------------------------------

describe('runDocs', () => {
  it('writes openapi.yaml to the configured path', async () => {
    const cap = captureOutput();
    try {
      await runDocs({ config: CONFIG_PATH });
    } finally {
      cap.restore();
    }
    const outFile = path.join(GENERATED_DIR, 'openapi.yaml');
    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, 'utf8');
    expect(content).toContain('openapi: 3.1.0');
    expect(content).toContain('title: Petstore API');
    expect(content).toContain('/pets:');
    expect(content).toContain('$ref: "#/components/schemas/Pet"');
    expect(cap.stdout).toContain('OpenAPI YAML written');
    expect(cap.stdout).toContain('component schema');
  });

  it('respects --format=json and writes JSON', async () => {
    const cap = captureOutput();
    try {
      await runDocs({
        config: CONFIG_PATH,
        output: './generated/openapi.json',
        format: 'json',
      });
    } finally {
      cap.restore();
    }
    const outFile = path.join(GENERATED_DIR, 'openapi.json');
    expect(fs.existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toBe('Petstore API');
  });

  it('creates nested output directories if they do not exist', async () => {
    const cap = captureOutput();
    try {
      await runDocs({
        config: CONFIG_PATH,
        output: './generated/deep/nested/openapi.yaml',
      });
    } finally {
      cap.restore();
    }
    expect(
      fs.existsSync(path.join(GENERATED_DIR, 'deep', 'nested', 'openapi.yaml')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// triad gherkin
// ---------------------------------------------------------------------------

describe('runGherkin', () => {
  it('writes .feature files to the configured directory', async () => {
    const cap = captureOutput();
    try {
      await runGherkin({ config: CONFIG_PATH });
    } finally {
      cap.restore();
    }
    const outDir = path.join(GENERATED_DIR, 'features');
    expect(fs.existsSync(outDir)).toBe(true);
    const files = fs.readdirSync(outDir);
    expect(files).toContain('pets.feature');
    const content = fs.readFileSync(path.join(outDir, 'pets.feature'), 'utf8');
    expect(content).toContain('Feature: Pets');
    expect(content).toContain('Scenario: Pets can be created with valid data');
    expect(cap.stdout).toContain('Wrote');
    expect(cap.stdout).toContain('pets.feature');
  });

  it('emits channel behaviors as scenarios alongside endpoint behaviors', async () => {
    // A tiny router with one HTTP endpoint and one WebSocket channel,
    // both in the same bounded context, verifies that `runGherkin`
    // passes channel behaviors through the same pipeline as endpoint
    // behaviors and that the bounded-context grouping applies to both.
    const channelRouterPath = path.join(FIXTURE_DIR, 'src/channel-app.ts');
    fs.writeFileSync(
      channelRouterPath,
      `import { createRouter, endpoint, channel, scenario, t } from '@triadjs/core';\n` +
        `const Msg = t.model('Msg', { text: t.string() });\n` +
        `const Ping = t.model('Ping', { ok: t.boolean() });\n` +
        `const ep = endpoint({\n` +
        `  name: 'ping', method: 'GET', path: '/ping', summary: 'ping',\n` +
        `  responses: { 200: { schema: Ping, description: 'ok' } },\n` +
        `  handler: async (ctx) => ctx.respond[200]({ ok: true }),\n` +
        `  behaviors: [\n` +
        `    scenario('Ping returns ok')\n` +
        `      .given('the service is up')\n` +
        `      .when('I GET /ping')\n` +
        `      .then('response status is 200'),\n` +
        `  ],\n` +
        `});\n` +
        `const chat = channel({\n` +
        `  name: 'chatRoom', path: '/ws/chat', summary: 'Chat',\n` +
        `  clientMessages: { send: { schema: Msg, description: 'send' } },\n` +
        `  serverMessages: { message: { schema: Msg, description: 'broadcast' } },\n` +
        `  handlers: { send: async () => {} },\n` +
        `  behaviors: [\n` +
        `    scenario('Users can broadcast a message')\n` +
        `      .given('a connected client')\n` +
        `      .body({ text: 'hi' })\n` +
        `      .when('client sends send')\n` +
        `      .then('client receives a message event'),\n` +
        `  ],\n` +
        `});\n` +
        `const router = createRouter({ title: 'x', version: '1' });\n` +
        `router.context('Realtime', { description: 'Live messaging' }, (c) => c.add(ep, chat));\n` +
        `export default router;\n`,
    );

    const cap = captureOutput();
    try {
      await runGherkin({
        config: CONFIG_PATH,
        router: './src/channel-app.ts',
      });
    } finally {
      cap.restore();
      fs.rmSync(channelRouterPath, { force: true });
    }

    const outDir = path.join(GENERATED_DIR, 'features');
    expect(fs.existsSync(outDir)).toBe(true);
    const files = fs.readdirSync(outDir);
    expect(files).toEqual(['realtime.feature']);

    const content = fs.readFileSync(
      path.join(outDir, 'realtime.feature'),
      'utf8',
    );
    expect(content).toContain('Feature: Realtime');
    expect(content).toContain('Live messaging');
    // Endpoint scenario emitted first.
    expect(content).toContain('Scenario: Ping returns ok');
    // Channel scenario emitted alongside it.
    expect(content).toContain('Scenario: Users can broadcast a message');
    expect(content).toContain('When client sends send');
    expect(content).toContain('Then client receives a message event');

    const pingIdx = content.indexOf('Scenario: Ping returns ok');
    const chatIdx = content.indexOf('Scenario: Users can broadcast a message');
    expect(pingIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeGreaterThan(pingIdx);

    // Report output mentions the single merged feature file.
    expect(cap.stdout).toContain('realtime.feature');
    expect(cap.stdout).toContain('2 scenarios');
  });
});

// ---------------------------------------------------------------------------
// triad test
// ---------------------------------------------------------------------------

describe('runTest', () => {
  it('runs all scenarios and reports them passing', async () => {
    const cap = captureOutput();
    try {
      await runTest({ config: CONFIG_PATH });
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain('3 scenarios');
    expect(cap.stdout).toContain('3 passed');
    expect(cap.stdout).toContain('Pets can be created with valid data');
  });

  it('throws TESTS_FAILED CliError when a scenario fails', async () => {
    // Temporarily swap in a broken router by writing a second config in the
    // fixture that points to the same router but declares bogus behaviors.
    const brokenConfig = path.join(FIXTURE_DIR, 'triad.broken.config.ts');
    const brokenRouter = path.join(FIXTURE_DIR, 'src/broken-app.ts');
    fs.writeFileSync(
      brokenRouter,
      `import { createRouter, endpoint, scenario, t } from '@triadjs/core';\n` +
        `const ep = endpoint({\n` +
        `  name: 'broken', method: 'GET', path: '/broken', summary: 'x',\n` +
        `  responses: { 200: { schema: t.string(), description: 'ok' } },\n` +
        `  handler: async (ctx) => ctx.respond[200]('ok'),\n` +
        `  behaviors: [\n` +
        `    scenario('Fails').given('x').when('y').then('response status is 404'),\n` +
        `  ],\n` +
        `});\n` +
        `const router = createRouter({ title: 'x', version: '1' });\n` +
        `router.add(ep);\n` +
        `export default router;\n`,
    );
    fs.writeFileSync(
      brokenConfig,
      `import { defineConfig } from '@triadjs/test-runner';\n` +
        `export default defineConfig({ router: './src/broken-app.ts' });\n`,
    );

    const cap = captureOutput();
    try {
      await expect(runTest({ config: brokenConfig })).rejects.toMatchObject({
        name: 'CliError',
        code: 'TESTS_FAILED',
      });
    } finally {
      cap.restore();
      fs.rmSync(brokenConfig, { force: true });
      fs.rmSync(brokenRouter, { force: true });
    }
  });

  it('applies --filter to limit which endpoints run', async () => {
    const cap = captureOutput();
    try {
      await runTest({ config: CONFIG_PATH, filter: 'createPet' });
    } finally {
      cap.restore();
    }
    // Only createPet's 2 scenarios should run
    expect(cap.stdout).toContain('2 scenarios');
    expect(cap.stdout).not.toContain('Unknown IDs return 404');
  });
});

// ---------------------------------------------------------------------------
// triad validate
// ---------------------------------------------------------------------------

describe('runValidate', () => {
  it('passes for the clean fixture petstore', async () => {
    const cap = captureOutput();
    try {
      await runValidate({ config: CONFIG_PATH });
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain('All checks passed');
  });
});

// ---------------------------------------------------------------------------
// validateRouter unit tests (pure logic, no fixture needed)
// ---------------------------------------------------------------------------

import { createRouter, endpoint, scenario, t, channel, type Behavior } from '@triadjs/core';
import { validateRouter } from '../src/commands/validate.js';

describe('validateRouter — cross-artifact checks', () => {
  function makePet() {
    return t.model('Pet', {
      id: t.string().format('uuid'),
      name: t.string(),
    });
  }

  it('reports duplicate endpoint names', () => {
    const Pet = makePet();
    const ep1 = endpoint({
      name: 'dup',
      method: 'GET',
      path: '/a',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const ep2 = endpoint({
      name: 'dup',
      method: 'GET',
      path: '/b',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'DUPLICATE_ENDPOINT_NAME'),
    ).toBe(true);
  });

  it('reports duplicate method+path combinations', () => {
    const Pet = makePet();
    const ep1 = endpoint({
      name: 'a',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const ep2 = endpoint({
      name: 'b',
      method: 'GET',
      path: '/pets',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep1, ep2);
    const issues = validateRouter(router);
    expect(issues.some((i) => i.code === 'DUPLICATE_PATH_METHOD')).toBe(true);
  });

  it('reports unknown model references in body_matches', () => {
    const Pet = makePet();
    const ep = endpoint({
      name: 'ep',
      method: 'GET',
      path: '/t',
      summary: 'x',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async () => ({ status: 200, body: {} }),
      behaviors: [
        scenario('Matches ghost')
          .given('x')
          .when('y')
          .then('response body matches Unicorn'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'UNKNOWN_MODEL_REFERENCE'),
    ).toBe(true);
  });

  it('warns on context model leakage', () => {
    const Pet = makePet();
    const Stranger = t.model('Stranger', { id: t.string() });
    const ep = endpoint({
      name: 'leaky',
      method: 'GET',
      path: '/leak',
      summary: 'x',
      responses: {
        200: { schema: Stranger, description: 'ok' },
      },
      handler: async () => ({ status: 200, body: {} }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'PetContext',
      { models: [Pet] },
      (ctx) => ctx.add(ep),
    );
    const issues = validateRouter(router);
    expect(
      issues.some(
        (i) =>
          i.code === 'CONTEXT_MODEL_LEAKAGE' && i.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('returns no issues for a clean router', () => {
    const Pet = makePet();
    const ep = endpoint({
      name: 'getPet',
      method: 'GET',
      path: '/pets/:id',
      summary: 'x',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) =>
        ctx.respond[200]({ id: ctx.params.id, name: 'x' }),
      behaviors: [
        scenario('ok')
          .given('x')
          .when('y')
          .then('response status is 200')
          .and('response body matches Pet'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    expect(validateRouter(router)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Channel-specific validation checks
// ---------------------------------------------------------------------------

describe('validateRouter — channel checks', () => {
  const ChatMessage = t.model('ChatMessage', {
    text: t.string(),
    sender: t.string(),
  });

  const JoinPayload = t.model('JoinPayload', {
    roomId: t.string(),
  });

  function makeChannel(overrides: Partial<{
    name: string;
    path: string;
    clientMessages: Record<string, { schema: ReturnType<typeof t.model>; description: string }>;
    serverMessages: Record<string, { schema: ReturnType<typeof t.model>; description: string }>;
    handlers: Record<string, () => void>;
    behaviors: Behavior[];
  }> = {}) {
    return channel({
      name: overrides.name ?? 'chat',
      path: overrides.path ?? '/ws/chat',
      summary: 'Chat channel',
      clientMessages: overrides.clientMessages ?? {
        sendMessage: { schema: ChatMessage, description: 'Send a message' },
      },
      serverMessages: overrides.serverMessages ?? {
        newMessage: { schema: ChatMessage, description: 'New message' },
      },
      handlers: overrides.handlers ?? {
        sendMessage: () => {},
      },
      behaviors: overrides.behaviors ?? [],
    });
  }

  it('reports duplicate channel names', () => {
    const ch1 = makeChannel({ name: 'chat', path: '/ws/chat' });
    const ch2 = makeChannel({ name: 'chat', path: '/ws/chat2' });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch1, ch2);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'DUPLICATE_CHANNEL_NAME'),
    ).toBe(true);
  });

  it('reports duplicate channel paths', () => {
    const ch1 = makeChannel({ name: 'chatA', path: '/ws/chat' });
    const ch2 = makeChannel({ name: 'chatB', path: '/ws/chat' });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch1, ch2);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'DUPLICATE_CHANNEL_PATH'),
    ).toBe(true);
  });

  it('warns when a client message type has no handler', () => {
    const ch = channel({
      name: 'chat',
      path: '/ws/chat',
      summary: 'Chat',
      clientMessages: {
        sendMessage: { schema: ChatMessage, description: 'Send' },
        joinRoom: { schema: JoinPayload, description: 'Join' },
      },
      serverMessages: {
        newMessage: { schema: ChatMessage, description: 'New' },
      },
      handlers: {
        sendMessage: () => {},
        joinRoom: () => {},
      },
      behaviors: [],
    });
    // Simulate a missing handler by removing one after construction
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (ch.handlers as Record<string, unknown>)['joinRoom'];

    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'MISSING_CHANNEL_HANDLER'),
    ).toBe(true);
  });

  it('warns when a channel assertion references a nonexistent server message type', () => {
    const ch = makeChannel({
      behaviors: [
        scenario('sends a message')
          .given('connected')
          .when('client sends a message')
          .then('alice receives a ghostMessage event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'UNKNOWN_CHANNEL_MESSAGE_TYPE'),
    ).toBe(true);
  });

  it('does not warn when assertion references a valid server message type', () => {
    const ch = makeChannel({
      behaviors: [
        scenario('sends a message')
          .given('connected')
          .when('client sends a message')
          .then('alice receives a newMessage event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'UNKNOWN_CHANNEL_MESSAGE_TYPE'),
    ).toBe(false);
  });

  it('warns on channel context model leakage from serverMessages', () => {
    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const Stranger = t.model('Stranger', { id: t.string() });
    const ch = channel({
      name: 'petChat',
      path: '/ws/pet-chat',
      summary: 'Pet chat',
      clientMessages: {
        send: { schema: Pet, description: 'Send' },
      },
      serverMessages: {
        notify: { schema: Stranger, description: 'Notify' },
      },
      handlers: { send: () => {} },
      behaviors: [],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'PetContext',
      { models: [Pet] },
      (ctx) => ctx.add(ch),
    );
    const issues = validateRouter(router);
    expect(
      issues.some(
        (i) =>
          i.code === 'CHANNEL_CONTEXT_MODEL_LEAKAGE' &&
          i.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('warns on channel context model leakage from clientMessages', () => {
    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const Stranger = t.model('Stranger', { id: t.string() });
    const ch = channel({
      name: 'petChat',
      path: '/ws/pet-chat',
      summary: 'Pet chat',
      clientMessages: {
        send: { schema: Stranger, description: 'Send' },
      },
      serverMessages: {
        notify: { schema: Pet, description: 'Notify' },
      },
      handlers: { send: () => {} },
      behaviors: [],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'PetContext',
      { models: [Pet] },
      (ctx) => ctx.add(ch),
    );
    const issues = validateRouter(router);
    expect(
      issues.some(
        (i) =>
          i.code === 'CHANNEL_CONTEXT_MODEL_LEAKAGE' &&
          i.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('does not warn when channel models match the bounded context', () => {
    const Pet = t.model('Pet', { id: t.string(), name: t.string() });
    const ch = channel({
      name: 'petChat',
      path: '/ws/pet-chat',
      summary: 'Pet chat',
      clientMessages: {
        send: { schema: Pet, description: 'Send' },
      },
      serverMessages: {
        notify: { schema: Pet, description: 'Notify' },
      },
      handlers: { send: () => {} },
      behaviors: [],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.context(
      'PetContext',
      { models: [Pet] },
      (ctx) => ctx.add(ch),
    );
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'CHANNEL_CONTEXT_MODEL_LEAKAGE'),
    ).toBe(false);
  });

  it('returns no issues for a clean channel', () => {
    const ch = makeChannel();
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    const channelIssues = issues.filter((i) => i.code.startsWith('DUPLICATE_CHANNEL') || i.code.startsWith('MISSING_CHANNEL') || i.code.startsWith('UNKNOWN_CHANNEL') || i.code.startsWith('CHANNEL_CONTEXT'));
    expect(channelIssues).toEqual([]);
  });

  it('catches channel_not_receives referencing nonexistent server message', () => {
    const ch = makeChannel({
      behaviors: [
        scenario('sender does not get echo')
          .given('connected')
          .when('client sends')
          .then('alice does NOT receive a phantom event'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'UNKNOWN_CHANNEL_MESSAGE_TYPE'),
    ).toBe(true);
  });

  it('catches channel_message_has referencing nonexistent server message', () => {
    const ch = makeChannel({
      behaviors: [
        scenario('message content check')
          .given('connected')
          .when('client sends')
          .then('alice receives a phantom with text "hello"'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ch);
    const issues = validateRouter(router);
    expect(
      issues.some((i) => i.code === 'UNKNOWN_CHANNEL_MESSAGE_TYPE'),
    ).toBe(true);
  });
});
