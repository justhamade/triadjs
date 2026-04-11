import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { securityHeadersHono } from '../src/hono.js';
import type { SecurityHeadersOptions } from '../src/types.js';

function makeApp(options: SecurityHeadersOptions = {}) {
  const app = new Hono();
  app.use('*', securityHeadersHono(options));
  app.get('/', (c) => {
    c.header('X-Powered-By', 'ShouldBeRemoved');
    return c.json({ ok: true });
  });
  app.get('/nonce', (c) => c.json({ nonce: c.get('cspNonce') ?? null }));
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return app;
}

describe('securityHeadersHono', () => {
  it('sets all default headers', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeDefined();
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('custom CSP directive is reflected', async () => {
    const app = makeApp({
      csp: { directives: { 'script-src': ["'self'", 'https://cdn.example.com'] } },
    });
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.headers.get('content-security-policy')).toContain(
      "script-src 'self' https://cdn.example.com",
    );
  });

  it('csp:false disables CSP entirely', async () => {
    const res = await makeApp({ csp: false }).fetch(new Request('http://localhost/'));
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('nonce mode sets a per-request nonce', async () => {
    const app = makeApp({ csp: { useNonce: true } });
    const res = await app.fetch(new Request('http://localhost/nonce'));
    const body = (await res.json()) as { nonce: string };
    expect(body.nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(res.headers.get('content-security-policy')).toContain(`'nonce-${body.nonce}'`);
  });

  it('each request gets a unique nonce', async () => {
    const app = makeApp({ csp: { useNonce: true } });
    const r1 = await app.fetch(new Request('http://localhost/nonce'));
    const r2 = await app.fetch(new Request('http://localhost/nonce'));
    const b1 = (await r1.json()) as { nonce: string };
    const b2 = (await r2.json()) as { nonce: string };
    expect(b1.nonce).not.toBe(b2.nonce);
  });

  it('composes with a sub-app mounted under a prefix', async () => {
    const inner = new Hono();
    inner.get('/pets', (c) => c.json({ items: [] }));

    const app = new Hono();
    app.use('*', securityHeadersHono());
    app.route('/api/v1', inner);

    const res = await app.fetch(new Request('http://localhost/api/v1/pets'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('headers appear on error responses', async () => {
    const res = await makeApp().fetch(new Request('http://localhost/boom'));
    expect(res.status).toBe(500);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('frameOptions SAMEORIGIN override', async () => {
    const res = await makeApp({ frameOptions: 'SAMEORIGIN' }).fetch(
      new Request('http://localhost/'),
    );
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
