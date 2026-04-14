import { describe, expect, it } from 'vitest';
import { t } from '@triadjs/core';
import { describeEndpoint, describeSchema } from '../src/schema-reader.js';
import type { FieldDescriptor, EndpointDescriptor } from '../src/schema-reader.js';
import { endpoint } from '@triadjs/core';

// ---------------------------------------------------------------------------
// Helper to build a minimal endpoint for testing describeEndpoint
// ---------------------------------------------------------------------------

function makeEndpoint(opts: {
  body?: Parameters<typeof t.model>[1];
  query?: Parameters<typeof t.model>[1];
  params?: Parameters<typeof t.model>[1];
}) {
  const ApiError = t.model('ApiError', {
    code: t.string(),
    message: t.string(),
  });

  return endpoint({
    name: 'test',
    method: 'POST',
    path: '/test',
    summary: 'test',
    request: {
      ...(opts.body ? { body: t.model('TestBody', opts.body) } : {}),
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.params ? { params: opts.params } : {}),
    },
    responses: {
      200: { schema: t.model('TestRes', { ok: t.boolean() }), description: 'OK' },
      400: { schema: ApiError, description: 'Bad request' },
    },
    handler: async (ctx) => ctx.respond[200]({ ok: true }),
  });
}

// ---------------------------------------------------------------------------
// describeSchema — unit tests for individual schema kinds
// ---------------------------------------------------------------------------

describe('describeSchema', () => {
  it('reads string constraints (minLength, maxLength, format)', () => {
    const schema = t.string().minLength(3).maxLength(50).format('email');
    const desc = describeSchema('email', schema);
    expect(desc.kind).toBe('string');
    expect(desc.constraints.minLength).toBe(3);
    expect(desc.constraints.maxLength).toBe(50);
    expect(desc.constraints.format).toBe('email');
  });

  it('reads string pattern as a string source', () => {
    const schema = t.string().pattern(/^[A-Z]+$/);
    const desc = describeSchema('code', schema);
    expect(desc.constraints.pattern).toBe('^[A-Z]+$');
  });

  it('reads int32 constraints (min, max)', () => {
    const schema = t.int32().min(1).max(100);
    const desc = describeSchema('age', schema);
    expect(desc.kind).toBe('int32');
    expect(desc.constraints.min).toBe(1);
    expect(desc.constraints.max).toBe(100);
  });

  it('reads int64 constraints', () => {
    const schema = t.int64().min(0);
    const desc = describeSchema('bigId', schema);
    expect(desc.kind).toBe('int64');
    expect(desc.constraints.min).toBe(0);
  });

  it('reads float32 constraints', () => {
    const schema = t.float32().min(0.0).max(1.0);
    const desc = describeSchema('ratio', schema);
    expect(desc.kind).toBe('float32');
    expect(desc.constraints.min).toBe(0.0);
    expect(desc.constraints.max).toBe(1.0);
  });

  it('reads float64 constraints', () => {
    const schema = t.float64().min(-180).max(180);
    const desc = describeSchema('longitude', schema);
    expect(desc.kind).toBe('float64');
    expect(desc.constraints.min).toBe(-180);
    expect(desc.constraints.max).toBe(180);
  });

  it('reads enum values', () => {
    const schema = t.enum('dog', 'cat', 'bird');
    const desc = describeSchema('species', schema);
    expect(desc.kind).toBe('enum');
    expect(desc.constraints.enumValues).toEqual(['dog', 'cat', 'bird']);
  });

  it('reads array constraints (minItems, maxItems)', () => {
    const schema = t.array(t.string()).minItems(1).maxItems(10);
    const desc = describeSchema('tags', schema);
    expect(desc.kind).toBe('array');
    expect(desc.constraints.minItems).toBe(1);
    expect(desc.constraints.maxItems).toBe(10);
  });

  it('reads nested model fields', () => {
    const Address = t.model('Address', {
      street: t.string().minLength(1),
      city: t.string(),
    });
    const desc = describeSchema('address', Address);
    expect(desc.kind).toBe('model');
    expect(desc.children).toBeDefined();
    expect(desc.children).toHaveLength(2);
    const streetChild = desc.children?.find((c) => c.name === 'street');
    expect(streetChild?.kind).toBe('string');
    expect(streetChild?.constraints.minLength).toBe(1);
  });

  it('reads optional/required distinction', () => {
    const optSchema = t.string().optional();
    const reqSchema = t.string();
    expect(describeSchema('opt', optSchema).required).toBe(false);
    expect(describeSchema('req', reqSchema).required).toBe(true);
  });

  it('reads nullable distinction', () => {
    const nullableSchema = t.string().nullable();
    expect(describeSchema('name', nullableSchema).nullable).toBe(true);
    expect(describeSchema('name', t.string()).nullable).toBe(false);
  });

  it('handles boolean schema with no constraints', () => {
    const desc = describeSchema('active', t.boolean());
    expect(desc.kind).toBe('boolean');
    expect(desc.constraints).toEqual({});
  });

  it('handles datetime schema', () => {
    const desc = describeSchema('createdAt', t.datetime());
    expect(desc.kind).toBe('datetime');
  });

  it('handles literal schema', () => {
    const desc = describeSchema('type', t.literal('pet'));
    expect(desc.kind).toBe('literal');
  });

  it('handles schema with no constraints gracefully', () => {
    const desc = describeSchema('name', t.string());
    expect(desc.kind).toBe('string');
    expect(desc.constraints.minLength).toBeUndefined();
    expect(desc.constraints.maxLength).toBeUndefined();
    expect(desc.constraints.format).toBeUndefined();
    expect(desc.constraints.pattern).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describeEndpoint — integration tests
// ---------------------------------------------------------------------------

describe('describeEndpoint', () => {
  it('returns body field descriptors from a model body', () => {
    const ep = makeEndpoint({
      body: {
        name: t.string().minLength(1),
        age: t.int32().min(0),
      },
    });
    const desc = describeEndpoint(ep);
    expect(desc.body).toHaveLength(2);
    expect(desc.body?.find((f) => f.name === 'name')?.kind).toBe('string');
    expect(desc.body?.find((f) => f.name === 'age')?.kind).toBe('int32');
  });

  it('returns null body when no body schema exists', () => {
    const ep = endpoint({
      name: 'noBody',
      method: 'GET',
      path: '/no-body',
      summary: 'No body',
      responses: {
        200: { schema: t.model('R', { ok: t.boolean() }), description: 'OK' },
      },
      handler: async (ctx) => ctx.respond[200]({ ok: true }),
    });
    const desc = describeEndpoint(ep);
    expect(desc.body).toBeNull();
  });

  it('returns declared status codes', () => {
    const ep = makeEndpoint({ body: { name: t.string() } });
    const desc = describeEndpoint(ep);
    expect(desc.declaredStatuses).toContain(200);
    expect(desc.declaredStatuses).toContain(400);
  });

  it('reads query field descriptors', () => {
    const ep = makeEndpoint({
      query: { limit: t.int32().min(1).max(100).optional() },
    });
    const desc = describeEndpoint(ep);
    expect(desc.query).toHaveLength(1);
    expect(desc.query?.[0]?.name).toBe('limit');
    expect(desc.query?.[0]?.required).toBe(false);
  });
});
