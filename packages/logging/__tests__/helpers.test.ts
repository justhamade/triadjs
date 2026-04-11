import { describe, it, expect } from 'vitest';
import { requestIdFromHeader } from '../src/index.js';

describe('requestIdFromHeader', () => {
  it('extracts x-request-id by default', () => {
    const extract = requestIdFromHeader();
    const ctx = { headers: { 'x-request-id': 'abc-123' } };
    expect(extract(ctx)).toBe('abc-123');
  });

  it('returns undefined when the header is missing', () => {
    const extract = requestIdFromHeader();
    expect(extract({ headers: {} })).toBeUndefined();
    expect(extract({})).toBeUndefined();
    expect(extract(undefined)).toBeUndefined();
  });

  it('respects a custom header name', () => {
    const extract = requestIdFromHeader('x-trace-id');
    const ctx = { headers: { 'x-trace-id': 'trace-9' } };
    expect(extract(ctx)).toBe('trace-9');
  });

  it('header lookup is case-insensitive', () => {
    const extract = requestIdFromHeader('X-Request-Id');
    const ctx = { headers: { 'x-request-id': 'abc-123' } };
    expect(extract(ctx)).toBe('abc-123');
  });
});
