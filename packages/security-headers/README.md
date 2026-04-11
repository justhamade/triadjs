# @triad/security-headers

Opinionated HTTP security headers for every Triad adapter (Fastify, Express, Hono).

Triad's `HandlerResponse` doesn't model response headers, so security headers have to be applied at the adapter layer. This package ships one middleware per adapter plus a shared configuration so you get the same defaults whichever HTTP runtime you use.

## Install

```bash
npm install @triad/security-headers
```

The HTTP framework(s) you use are optional peers — install whichever you need:

```bash
npm install fastify     # if you use @triad/fastify
npm install express     # if you use @triad/express
npm install hono        # if you use @triad/hono
```

## Quick start

### Fastify

```ts
import Fastify from 'fastify';
import { securityHeadersFastify } from '@triad/security-headers';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';

const app = Fastify();
await app.register(securityHeadersFastify, {});
await app.register(triadPlugin, { router });
await app.listen({ port: 3000 });
```

Register `@triad/security-headers` **before** `@triad/fastify`'s `triadPlugin` so the headers apply to every Triad route.

### Express

```ts
import express from 'express';
import { securityHeadersExpress } from '@triad/security-headers';
import { createTriadRouter } from '@triad/express';
import router from './app.js';

const app = express();
app.use(securityHeadersExpress());
app.use(express.json());
app.use(createTriadRouter(router));
app.listen(3000);
```

Mount `securityHeadersExpress()` **before** your routes — Express runs middleware in registration order.

### Hono

```ts
import { Hono } from 'hono';
import { securityHeadersHono } from '@triad/security-headers';
import { createTriadApp } from '@triad/hono';
import router from './app.js';

const app = new Hono();
app.use('*', securityHeadersHono());
app.route('/', createTriadApp(router));
export default app;
```

## Default headers

Calling the middleware with no options produces:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Plus `X-Powered-By` is removed on every response.

| Header | Default | Purpose |
| --- | --- | --- |
| Content-Security-Policy | strict, `'self'`-only | Mitigates XSS, clickjacking via frame-ancestors, and mixed content |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` | Forces HTTPS for 2 years |
| X-Content-Type-Options | `nosniff` | Prevents MIME sniffing |
| X-Frame-Options | `DENY` | Legacy clickjacking defense (CSP frame-ancestors supersedes) |
| Referrer-Policy | `strict-origin-when-cross-origin` | Limits Referer leakage |
| Permissions-Policy | camera/mic/geolocation/etc disabled | Denies dangerous browser features |
| Cross-Origin-Opener-Policy | `same-origin` | Isolates browsing context group |
| Cross-Origin-Resource-Policy | `same-origin` | Blocks cross-origin embedding of responses |
| Cross-Origin-Embedder-Policy | (disabled) | Only enable if you need `SharedArrayBuffer` — it breaks many embeds |

## CSP customization

### Add allowed sources

```ts
securityHeadersExpress({
  csp: {
    directives: {
      'script-src': ["'self'", 'https://cdn.example.com'],
      'img-src': ["'self'", 'data:', 'https://images.example.com'],
    },
  },
});
```

Your directives are merged on top of the defaults — unspecified directives keep their defaults. Pass an empty array to clear a directive entirely.

### Report-only mode

```ts
securityHeadersExpress({
  csp: { reportOnly: true, directives: { 'report-uri': ['/csp-report'] } },
});
```

Emits `Content-Security-Policy-Report-Only` instead of the enforcing header — useful for dry-runs before tightening a live policy.

### CSP nonces

Per-request nonces let you allow specific inline `<script>` blocks without `'unsafe-inline'`:

```ts
securityHeadersFastify({ csp: { useNonce: true } });

// In a handler:
app.get('/', (request, reply) => {
  const nonce = request.cspNonce; // string
  return `<script nonce="${nonce}">console.log('hi')</script>`;
});
```

- Nonce is generated per request via `node:crypto.randomBytes(16).toString('base64')`.
- It's attached to the framework-specific request object (`request.cspNonce` on Fastify/Express, `c.get('cspNonce')` on Hono).
- The nonce is appended to `script-src` and `style-src` in the emitted CSP header.
- Static configs allocate headers once; nonce configs pay a small per-request cost.

## HSTS preload

```ts
securityHeadersExpress({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
});
```

**Preload is effectively irreversible.** Only enable `preload: true` after verifying every subdomain works over HTTPS and you're willing to commit for 1–2 years. See <https://hstspreload.org>.

## Disabling individual headers

Pass `false` for any header you don't want:

```ts
securityHeadersExpress({
  csp: false,               // Turn off CSP entirely
  coep: false,              // Already the default
  frameOptions: false,      // Don't set X-Frame-Options
  removePoweredBy: false,   // Leave the framework's X-Powered-By alone
});
```

## Composition with other middleware

Security headers middleware is cheap (no per-request work for static configs) and safe to mount before body parsers, auth middleware, CORS, rate limiters, and Triad routers. Recommended order:

1. `securityHeadersXxx()`
2. CORS (`@fastify/cors` / `cors` / `hono/cors`)
3. Rate limit (`@fastify/rate-limit` / `express-rate-limit` / `@hono/rate-limiter`)
4. Body parsers, auth
5. Triad router

## Reference API

```ts
export function computeHeaders(options?: SecurityHeadersOptions): HeaderFactory;
export const securityHeadersFastify: FastifyPluginAsync<SecurityHeadersOptions>;
export function securityHeadersExpress(options?: SecurityHeadersOptions): RequestHandler;
export function securityHeadersHono(options?: SecurityHeadersOptions): MiddlewareHandler;
export function generateNonce(): string;
export const DEFAULT_CSP, DEFAULT_HSTS, DEFAULT_PERMISSIONS_POLICY, MINIMAL_OPTIONS;
```

`computeHeaders` is framework-agnostic; the three adapter wrappers all call it. If you're building your own adapter you can use it directly.

## v1 limitations

- **No per-route overrides.** The middleware applies to every response in its scope. If you need `/api` to have different headers than `/public`, mount two instances on two scopes.
- **No CSP reporting endpoint helper.** Use `csp.directives['report-uri']` or `report-to` and wire up your own endpoint.
- **No automatic CSP generation.** Unlike some tools, this package won't inspect your HTML and derive directives. You write them.
- **Express `removePoweredBy` monkey-patches `res.setHeader`.** Express adds `X-Powered-By` inside `res.send`, which runs after middleware, so we intercept subsequent writes. This is the standard Helmet approach — it's reliable but will surprise anyone inspecting the middleware chain.
- **Hono header removal** uses `c.header(name, undefined)`, which clears the header in Hono's response storage.

See the full security cookbook at [`docs/guides/security.md`](../../docs/guides/security.md) for rate limiting, CORS, CSRF, secrets management, and a pre-production checklist.
