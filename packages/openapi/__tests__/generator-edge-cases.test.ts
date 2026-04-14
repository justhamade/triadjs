/**
 * Phase 24 — behavior-coverage audit: OpenAPI generator edge cases.
 */

import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import { generateOpenAPI, convertPath } from '../src/generator.js';

describe('generateOpenAPI — router with no endpoints', () => {
  it('returns a valid OpenAPI 3.1 doc with empty paths', () => {
    const r = createRouter({ title: 'Empty', version: '1.0.0' });
    const doc = generateOpenAPI(r);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths).toEqual({});
    expect(doc.components.schemas).toEqual({});
  });

  it('omits servers when none are declared', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const doc = generateOpenAPI(r);
    expect(doc.servers).toBeUndefined();
  });

  it('omits tags when neither contexts nor endpoint tags exist', () => {
    const r = createRouter({ title: 'x', version: '1' });
    const doc = generateOpenAPI(r);
    expect(doc.tags).toBeUndefined();
  });
});

describe('convertPath — edge cases', () => {
  it('handles a path with no leading slash', () => {
    expect(convertPath('pets/:id')).toBe('pets/{id}');
  });

  it('returns the empty string when given an empty string', () => {
    expect(convertPath('')).toBe('');
  });

  it('does not touch segments that are not colon-prefixed identifiers', () => {
    expect(convertPath('/pets/:id/foo-bar')).toBe('/pets/{id}/foo-bar');
  });
});

describe('generateOpenAPI — empty responses and edge cases', () => {
  const Ok = t.model('Ok', { ok: t.boolean() });

  it('204-only endpoints produce a response without a content field', () => {
    const del = endpoint({
      name: 'del',
      method: 'DELETE',
      path: '/x/:id',
      summary: 'd',
      request: { params: { id: t.string() } },
      responses: { 204: { schema: t.empty(), description: 'gone' } },
      handler: async (ctx) => ctx.respond[204](),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(del);
    const doc = generateOpenAPI(r);
    const op = doc.paths['/x/{id}']?.delete;
    expect(op?.responses['204']).toBeDefined();
    expect(op?.responses['204']?.content).toBeUndefined();
  });

  it('endpoints in one context get the context tag appended (deduped)', () => {
    const ep = endpoint({
      name: 'tagged',
      method: 'GET',
      path: '/t',
      summary: 's',
      tags: ['Pets'],
      responses: { 200: { schema: Ok, description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]({ ok: true }),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.context('Pets', {}, (c) => c.add(ep));
    const doc = generateOpenAPI(r);
    const op = doc.paths['/t']?.get;
    // 'Pets' from explicit tags must still be present and not duplicated.
    expect(op?.tags).toEqual(['Pets']);
  });
});

describe('generateOpenAPI — deeply nested models', () => {
  const Leaf = t.model('Leaf', { value: t.string() });
  const Middle = t.model('Middle', { leaf: Leaf });
  const Top = t.model('Top', { middle: Middle });

  it('registers every nested model in components.schemas', () => {
    const ep = endpoint({
      name: 'getTop',
      method: 'GET',
      path: '/top',
      summary: 'top',
      responses: { 200: { schema: Top, description: 'ok' } },
      handler: async (ctx) =>
        ctx.respond[200]({ middle: { leaf: { value: 'x' } } }),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(ep);
    const doc = generateOpenAPI(r);
    expect(doc.components.schemas['Top']).toBeDefined();
    expect(doc.components.schemas['Middle']).toBeDefined();
    expect(doc.components.schemas['Leaf']).toBeDefined();
  });
});

describe('generateOpenAPI — large enums and unicode', () => {
  it('emits all enum values even for 100+ entries', () => {
    const values = Array.from({ length: 100 }, (_, i) => `v${i}`) as [string, ...string[]];
    const Big = t.enum(...values);
    const ep = endpoint({
      name: 'big',
      method: 'GET',
      path: '/big',
      summary: 's',
      responses: { 200: { schema: Big, description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('v0'),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(ep);
    const doc = generateOpenAPI(r);
    const schema = doc.paths['/big']?.get?.responses['200']?.content?.['application/json']
      ?.schema;
    expect(schema?.enum).toHaveLength(100);
  });

  it('preserves unicode characters in model titles', () => {
    const Unicode = t.model('Ünïcöde', { name: t.string() });
    const ep = endpoint({
      name: 'u',
      method: 'GET',
      path: '/u',
      summary: 's',
      responses: { 200: { schema: Unicode, description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]({ name: 'x' }),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(ep);
    const doc = generateOpenAPI(r);
    expect(doc.components.schemas['Ünïcöde']).toBeDefined();
  });
});

describe('generateOpenAPI — request params deduplication', () => {
  it('path parameters are always flagged required even when schema is optional', () => {
    const ep = endpoint({
      name: 'x',
      method: 'GET',
      path: '/x/:id',
      summary: 's',
      request: { params: { id: t.string().optional() } },
      responses: { 200: { schema: t.model('X', {}), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]({}),
    });
    const r = createRouter({ title: 'x', version: '1' });
    r.add(ep);
    const doc = generateOpenAPI(r);
    const param = doc.paths['/x/{id}']?.get?.parameters?.find((p) => p.name === 'id');
    expect(param?.required).toBe(true);
  });
});
