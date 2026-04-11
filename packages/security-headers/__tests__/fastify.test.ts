import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { securityHeadersFastify } from '../src/fastify.js';

async function makeApp(options: Parameters<typeof securityHeadersFastify>[1] = {}) {
  const app = Fastify();
  await app.register(securityHeadersFastify, options);
  app.get('/', async (_req, reply) => {
    reply.header('x-powered-by', 'ShouldBeRemoved');
    return { ok: true };
  });
  app.get('/boom', async () => {
    throw new Error('boom');
  });
  app.get('/nonce', async (req) => ({ nonce: req.cspNonce ?? null }));
  return app;
}

describe('securityHeadersFastify', () => {
  it('sets all default headers on a response', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('custom CSP directive is reflected', async () => {
    const app = await makeApp({
      csp: { directives: { 'script-src': ["'self'", 'https://cdn.example.com'] } },
    });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://cdn.example.com",
    );
  });

  it('removes X-Powered-By by default', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('leaves X-Powered-By alone when removePoweredBy:false', async () => {
    const app = await makeApp({ removePoweredBy: false });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-powered-by']).toBe('ShouldBeRemoved');
  });

  it('csp:false disables CSP entirely', async () => {
    const app = await makeApp({ csp: false });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('nonce mode sets unique CSP nonce per request', async () => {
    const app = await makeApp({ csp: { useNonce: true } });
    const r1 = await app.inject({ method: 'GET', url: '/' });
    const r2 = await app.inject({ method: 'GET', url: '/' });
    const csp1 = r1.headers['content-security-policy'] as string;
    const csp2 = r2.headers['content-security-policy'] as string;
    expect(csp1).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp2).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp1).not.toBe(csp2);
  });

  it('nonce is exposed on request.cspNonce', async () => {
    const app = await makeApp({ csp: { useNonce: true } });
    const res = await app.inject({ method: 'GET', url: '/nonce' });
    const body = res.json() as { nonce: string | null };
    expect(body.nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain(`'nonce-${body.nonce}'`);
  });

  it('headers are emitted on error responses', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('concurrent requests get independent nonces', async () => {
    const app = await makeApp({ csp: { useNonce: true } });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'GET', url: '/nonce' })),
    );
    const nonces = results.map((r) => (r.json() as { nonce: string }).nonce);
    const unique = new Set(nonces);
    expect(unique.size).toBe(5);
  });

  it('plugin registers without error with no options', async () => {
    const app = Fastify();
    await app.register(securityHeadersFastify, {});
    app.get('/ping', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
