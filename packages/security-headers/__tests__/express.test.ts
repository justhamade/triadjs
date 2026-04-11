import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeadersExpress } from '../src/express.js';
import type { SecurityHeadersOptions } from '../src/types.js';

function makeApp(options: SecurityHeadersOptions = {}) {
  const app = express();
  app.use(securityHeadersExpress(options));
  app.get('/', (_req, res) => {
    res.setHeader('X-Powered-By', 'ShouldBeRemoved');
    res.json({ ok: true });
  });
  app.get('/nonce', (req, res) => {
    res.json({ nonce: req.cspNonce ?? null });
  });
  app.get('/boom', (_req, _res, next) => {
    next(new Error('boom'));
  });
  return app;
}

describe('securityHeadersExpress', () => {
  it('sets all default headers', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
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
    const app = makeApp({
      csp: { directives: { 'script-src': ["'self'", 'https://cdn.example.com'] } },
    });
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://cdn.example.com",
    );
  });

  it('csp:false disables CSP entirely', async () => {
    const res = await request(makeApp({ csp: false })).get('/');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('removes Express default X-Powered-By', async () => {
    const app = express();
    app.use(securityHeadersExpress());
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('leaves Express X-Powered-By when removePoweredBy:false', async () => {
    const app = express();
    app.use(securityHeadersExpress({ removePoweredBy: false }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBe('Express');
  });

  it('nonce mode sets req.cspNonce', async () => {
    const res = await request(makeApp({ csp: { useNonce: true } })).get('/nonce');
    const body = res.body as { nonce: string };
    expect(body.nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(res.headers['content-security-policy']).toContain(`'nonce-${body.nonce}'`);
  });

  it('each request gets a unique nonce', async () => {
    const app = makeApp({ csp: { useNonce: true } });
    const r1 = await request(app).get('/nonce');
    const r2 = await request(app).get('/nonce');
    expect((r1.body as { nonce: string }).nonce).not.toBe(
      (r2.body as { nonce: string }).nonce,
    );
  });

  it('composes with a JSON body parser mounted afterwards', async () => {
    const app = express();
    app.use(securityHeadersExpress());
    app.use(express.json());
    app.post('/echo', (req, res) => {
      res.json(req.body);
    });
    const res = await request(app).post('/echo').send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.body).toEqual({ a: 1 });
  });

  it('headers appear on error responses via default express error handler', async () => {
    const res = await request(makeApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('frameOptions:SAMEORIGIN override', async () => {
    const res = await request(makeApp({ frameOptions: 'SAMEORIGIN' })).get('/');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
