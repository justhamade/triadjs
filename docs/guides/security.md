# Security cookbook

> A consolidated guide to securing a Triad application end-to-end: HTTP
> headers, rate limits, CORS, CSRF, input sanitization, secrets,
> dependencies, observability, and a pre-production checklist.

**Related reading**

- [`@triadjs/security-headers`](../../packages/security-headers/README.md) — the package that sets HTTP security headers across all three adapters.
- [`@triadjs/jwt`](../../packages/jwt/README.md) — JWT verification built on `jose`.
- [Authentication cookbook](./auth.md) — everything auth-related; this guide links out rather than duplicating.
- [Observability cookbook](./observability.md) — logging, metrics, tracing.
- [Deploying to AWS](./deploying-to-aws.md) — cloud-level hardening patterns.

---

## Table of contents

1. [Threat model for a typical Triad app](#1-threat-model-for-a-typical-triad-app)
2. [Security headers via `@triadjs/security-headers`](#2-security-headers-via-triadsecurity-headers)
3. [Rate limiting per adapter](#3-rate-limiting-per-adapter)
4. [CORS configuration per adapter](#4-cors-configuration-per-adapter)
5. [CSRF protection](#5-csrf-protection)
6. [Input sanitization beyond schema validation](#6-input-sanitization-beyond-schema-validation)
7. [Secrets management](#7-secrets-management)
8. [Dependency security](#8-dependency-security)
9. [Observability as a security tool](#9-observability-as-a-security-tool)
10. [OWASP Top 10 coverage audit](#10-owasp-top-10-coverage-audit)
11. [Pre-production security checklist](#11-pre-production-security-checklist)
12. [FAQ](#12-faq)

---

## 1. Threat model for a typical Triad app

Before reaching for middleware, it helps to name what you're defending against. A typical Triad service is a JSON-over-HTTP API serving browsers and/or other services. The realistic threat model looks like this.

### What an attacker can observe

- **Request and response bodies.** Anything you accept or return is visible over the wire, on TLS-terminating load balancers, in access logs, and in any caching layer between you and the client. Assume every field in your schemas is observable.
- **Headers and URLs.** Query strings land in access logs, referrer headers, and browser history. Bearer tokens in URLs are the single most common credential leak in the wild.
- **Timing.** Response latency reveals which branch of your code ran. Constant-time comparison matters for secrets.
- **Error envelopes.** Triad's default error shape is already opaque (`{ error: { code, message } }`) — don't leak stack traces, SQL, or internal IDs in `message`.

### What an attacker can do

- Send arbitrary HTTP — any method, any path, any body.
- Replay captured requests, including signed-but-unexpired JWTs.
- Guess sequential IDs, probe enumeration attacks against login and "forgot password" endpoints.
- Feed you malformed input that a hand-rolled validator might accept but Triad's Zod-backed schemas reject. (This is where Triad does a lot of the work for you.)
- Fingerprint your stack via error strings, header banners, 404 behavior, and timing.

### What Triad protects by default

- **Schema validation at the boundary.** Every request body, path param, and query string is validated against a schema before it reaches your handler. Malformed payloads produce a 400 with a structured `{ error: { code: 'VALIDATION', details } }` envelope, never a thrown exception or unchecked `any`.
- **Typed responses.** If your handler returns a shape that doesn't match its response schema, the adapter returns 500 and logs the mismatch. You can't accidentally leak fields that weren't in the schema.
- **Ownership checks via `checkOwnership`.** When you use the helper, IDOR (insecure direct object reference) attacks become statically visible — the type system won't let you return a record whose owner doesn't match the authenticated caller.
- **Error envelopes.** Thrown errors are caught by the adapter and reshaped into `ApiError`-style responses — no stack traces, no framework internals.

### What Triad does NOT protect against

- **Rate limits.** Nothing in Triad stops an attacker from sending 100k requests per second. See §3.
- **DDoS.** Layer-3/4 volumetric attacks require upstream defenses (Cloudflare, AWS Shield, etc.).
- **XSS in user-rendered content.** Triad validates strings but doesn't escape them when you emit them into HTML. See §6.
- **Supply-chain compromise.** A malicious transitive dep is indistinguishable from your own code at runtime. See §8.
- **Infrastructure misconfiguration.** An S3 bucket with public read access defeats everything your server does.

The rest of this cookbook covers the defenses you bolt on top of Triad to close those gaps.

---

## 2. Security headers via `@triadjs/security-headers`

Triad's `HandlerResponse` deliberately doesn't carry response headers — routers produce typed bodies, adapters turn them into HTTP. Security headers therefore belong at the adapter layer, and `@triadjs/security-headers` is the one place they're configured.

See [the package README](../../packages/security-headers/README.md) for the full API reference. This section covers **why** each header matters.

### CSP (Content-Security-Policy)

CSP is the single highest-leverage header. It's a browser-enforced allowlist for where scripts, styles, images, and so on can be loaded from. A strict CSP turns most stored-XSS vulnerabilities into dead code — even if an attacker injects `<script src="https://evil.example.com/pwn.js">` into a page, the browser refuses to load it.

Key directives:

- `default-src 'self'` — everything defaults to same-origin.
- `script-src 'self'` — no inline scripts, no `eval`, no cross-origin JS.
- `object-src 'none'` — blocks Flash, plugins, legacy `<object>` vectors.
- `base-uri 'self'` — prevents `<base href="https://evil.example.com/">` hijacks.
- `frame-ancestors 'self'` — modern replacement for `X-Frame-Options`.
- `upgrade-insecure-requests` — auto-rewrites HTTP sub-resources to HTTPS.

The default config ships `'unsafe-inline'` on `style-src` because most real applications still have at least one inline `style=""`. You can and should tighten this with nonces or hashes when your app allows.

### HSTS (Strict-Transport-Security)

HSTS tells the browser to refuse HTTP entirely for your domain. Once set with `max-age=63072000; includeSubDomains`, the browser will upgrade every request for the next two years, even if the user types `http://`. This defeats SSL-stripping MITM attacks on public Wi-Fi.

`preload: true` is irreversible — don't set it until you've verified every subdomain works over HTTPS, and understand that removing preload takes months.

### X-Content-Type-Options: nosniff

Without this header, some browsers try to "helpfully" detect that a file served as `text/plain` is actually JavaScript, and execute it. `nosniff` kills that behavior. Zero downside.

### X-Frame-Options / CSP frame-ancestors

Both defend against clickjacking — an attacker embedding your page in a transparent `<iframe>` on `evil.example.com` and tricking the user into clicking something. `frame-ancestors 'self'` in CSP is the modern form; `X-Frame-Options: DENY` is the legacy fallback.

### Referrer-Policy

Controls the `Referer` header on outgoing requests. The default `strict-origin-when-cross-origin` sends the full URL to same-origin requests and only the origin to cross-origin ones — this prevents tokens in query strings from leaking to third parties via image beacons.

### Permissions-Policy

Formerly `Feature-Policy`. Disables dangerous browser APIs (camera, microphone, geolocation, payment, USB) by default so a compromised third-party script can't silently request them. Opt features back in explicitly when your app needs them.

### COOP / COEP / CORP

Cross-origin isolation headers. `same-origin` defaults prevent cross-origin windows from reading your page's state (a prerequisite for Spectre-style leaks). COEP is deliberately off by default because `require-corp` breaks many embedded iframes — only enable it when you need `SharedArrayBuffer`.

---

## 3. Rate limiting per adapter

`@triadjs/security-headers` does not ship rate limiting — the per-adapter ecosystems have excellent libraries already, and duplicating them would be lower quality. Here's what to reach for.

### Fastify — `@fastify/rate-limit`

```ts
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  max: 100,                // requests
  timeWindow: '1 minute',
  keyGenerator: (req) => req.headers['x-real-ip'] as string ?? req.ip,
});
```

For per-route overrides (much stricter on auth endpoints):

```ts
app.post('/login', {
  config: {
    rateLimit: { max: 5, timeWindow: '1 minute' },
  },
}, loginHandler);
```

For user-based limits once you have an authenticated identity:

```ts
await app.register(rateLimit, {
  keyGenerator: (req) => req.user?.id ?? req.ip,
});
```

### Express — `express-rate-limit`

```ts
import rateLimit from 'express-rate-limit';

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,     // send RateLimit-* headers
  legacyHeaders: false,
}));

app.use('/login', rateLimit({ windowMs: 60 * 1000, max: 5 }));
```

### Hono — `hono-rate-limiter`

```ts
import { rateLimiter } from 'hono-rate-limiter';

app.use('*', rateLimiter({
  windowMs: 60_000,
  limit: 100,
  keyGenerator: (c) => c.req.header('x-real-ip') ?? 'anon',
}));
```

### Fixed window vs sliding window

- **Fixed window** resets the counter at a wall-clock boundary (e.g. every minute). Simple, memory-light, but allows a burst of 2x the limit at the boundary (50 requests at 0:59 followed by 50 at 1:00).
- **Sliding window** tracks a rolling time window. More accurate, more memory. Most of the libraries above default to sliding.

Pick sliding for public APIs where burst smoothing matters. Pick fixed when you just want a cheap DoS floor.

### Distributed rate limiting

If you run multiple instances behind a load balancer, an in-process counter lets an attacker get `instances × limit` requests per window. Back the rate limiter with Redis:

- `@fastify/rate-limit` ships a Redis store via `redis` option.
- `express-rate-limit` supports stores like `rate-limit-redis` or `rate-limit-memcached`.
- Hono's rate limiter accepts a custom store.

### Triad-specific pattern: different limits per endpoint class

Auth endpoints need stricter limits than read endpoints — brute-force a login form with 100 req/s and your users' passwords fall off the CAPS index. A workable split:

- Public unauthenticated reads: 100 req/min per IP.
- Authenticated reads: 300 req/min per user.
- Writes: 60 req/min per user.
- Auth endpoints (`/login`, `/signup`, `/forgot-password`): 5 req/min per IP.

---

## 4. CORS configuration per adapter

CORS is a browser-enforced, server-declared policy. Your server sends `Access-Control-Allow-Origin` headers; the browser decides whether to let JavaScript read the response. Misconfiguring CORS is the single most common way APIs get accidentally opened up to the world.

### Fastify — `@fastify/cors`

```ts
import cors from '@fastify/cors';

await app.register(cors, {
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  maxAge: 86400,
});
```

### Express — `cors`

```ts
import cors from 'cors';

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowlist.includes(origin)) return cb(null, true);
    cb(new Error('CORS'));
  },
  credentials: true,
}));
```

### Hono — built-in `cors`

```ts
import { cors } from 'hono/cors';

app.use('*', cors({
  origin: 'https://app.example.com',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));
```

### Common gotchas

- **Trailing slash on origin.** `https://app.example.com` and `https://app.example.com/` are different strings. Most libraries normalize, but not all.
- **Credentials + wildcard.** `Access-Control-Allow-Origin: *` is incompatible with `Access-Control-Allow-Credentials: true`. Browsers refuse the combination. If you need cookies across origins, you must reflect the origin explicitly.
- **Preflight caching.** Set `maxAge` to at least a few minutes — without it every cross-origin request pays an extra preflight round-trip.
- **Wildcard methods.** `allowMethods: '*'` sounds convenient but advertises methods you don't support. Be specific.

### When to use `origin: '*'`

Only for truly public APIs with no cookies or bearer tokens — for example a public read-only data feed. Everything else should use an allowlist.

---

## 5. CSRF protection

**You only need CSRF protection if you authenticate via cookies.** Bearer tokens sent in the `Authorization` header are immune — the browser doesn't automatically attach them to cross-origin requests, so an attacker's page on `evil.example.com` can't forge an authenticated request to your API.

If you do use cookie auth (typical for SSR apps), pick one of the two standard patterns.

### Double-submit cookie pattern

The server sets a random token in a cookie (readable by JavaScript) and requires the same token in a header on every mutation. An attacker's page can set headers to its own origin but can't read the cookie from yours, so it can't match them.

```ts
import type { BeforeHandler } from '@triadjs/core';
import { randomBytes } from 'node:crypto';

const csrfGuard: BeforeHandler = async (ctx) => {
  const cookie = ctx.request.headers.cookie?.match(/csrf=([^;]+)/)?.[1];
  const header = ctx.request.headers['x-csrf-token'];
  if (!cookie || !header || cookie !== header) {
    return { status: 403, body: { error: { code: 'CSRF', message: 'Invalid CSRF token' } } };
  }
  return undefined;
};
```

On login, set the cookie:

```
Set-Cookie: csrf=<random>; Path=/; SameSite=Strict; Secure
```

Your frontend reads the cookie and echoes the value in `X-CSRF-Token` on every POST/PATCH/DELETE.

### Synchronizer token pattern

Server-side token store. On login, issue a random token, store it in a session table keyed by session ID, and require it on every mutation. Slightly more secure (the token never appears in a cookie) but requires server state.

### SameSite as first-line defense

Modern browsers default to `SameSite=Lax` on cookies, which already blocks most CSRF. `SameSite=Strict` is even stronger but breaks scenarios where a user clicks a link from a third-party email to a logged-in page. Use `Strict` for session cookies, `Lax` for other cookies, and CSRF tokens as a belt-and-suspenders second layer.

For the full auth context (how you got those cookies in the first place), see the [authentication cookbook](./auth.md).

---

## 6. Input sanitization beyond schema validation

Triad's schemas catch type and shape issues. They don't catch business-semantics issues, and they don't escape values for the contexts you emit them into.

### HTML / SQL injection

- Triad's schema validates that a string is a string. If you then interpolate that string into HTML, you have XSS. Use a templating engine that auto-escapes (React, Svelte, Vue, Lit, Handlebars with `{{ }}`), or manually escape via `DOMPurify` / `sanitize-html`.
- If you interpolate into SQL, you have SQL injection. **Always** use parameterized queries. Drizzle (see `@triadjs/drizzle`) handles this for you — never fall back to raw string interpolation.
- If you interpolate into shell commands (spawning processes), use `execFile`/`spawn` with an argument array, never `exec` with a concatenated string.

### File upload safety

Users can lie about a file's MIME type — a file claimed as `image/png` may be a polyglot PDF-PHP shell. Defenses:

- **Verify magic bytes.** The first few bytes of a file identify its real type. Libraries like `file-type` do this.
- **Bound file size.** Use `t.file().maxSize(...)` in your Triad schema to reject oversize uploads at the boundary.
- **Bound file count.** Triad's adapter defaults to 10 files per request; override if your use case differs.
- **Never serve uploaded files from your primary domain.** Serve from a separate origin (`uploads.example.com`) so a stored XSS in an uploaded SVG can't read cookies from your main site.
- **Never execute uploaded files.** Store them in object storage, not on a filesystem next to your code.

### URL validation and SSRF

If your API accepts URLs from users (webhooks, avatar URLs, image proxy) and then fetches them server-side, you have an SSRF surface. Zod's `.url()` catches syntax but not semantics. You also need:

- **Allowlist schemes** (`https:` only).
- **Block private IP ranges** (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`).
- **Resolve and re-check** — an attacker can set a DNS record that resolves to `127.0.0.1`; you must resolve the hostname and check the resulting IP before making the request.
- **Disable redirect following** or validate every redirect target.

### Log injection

If you write user-supplied strings to logs via `console.log`, an attacker can inject fake log lines (newlines, ANSI escapes) that confuse log parsers. Structured logging via [`@triadjs/logging`](../../packages/logging/README.md) emits JSON objects — newlines inside field values become `\n` in the JSON-encoded form and can't forge new log entries.

---

## 7. Secrets management

### Never commit secrets

- Add patterns to `.gitignore`: `.env`, `.env.*`, `*.pem`, `credentials.json`.
- Use `git-secrets` or `gitleaks` as pre-commit hooks to catch accidental commits.
- If a secret ever makes it into git history, rotate it immediately — `git filter-repo` cleans history but cannot un-ring the bell, since anyone who pulled has the secret.

### Environment variables

Pros: universal, every framework supports them, easy to override per environment.
Cons: process-wide visibility, can leak in crash dumps, hard to rotate without restart.

Fine for small apps. For anything with compliance requirements, move to a secrets manager.

### AWS Secrets Manager / Vault / GCP Secret Manager

These services hold your secrets, let you rotate them on a schedule, and audit every fetch. Pattern for Triad:

```ts
// src/secrets.ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

export async function loadSecrets() {
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.SECRETS_ARN! }),
  );
  return JSON.parse(SecretString!);
}

// src/server.ts
const secrets = await loadSecrets();
const services = { db: createDb(secrets.DATABASE_URL), jwt: createJwt(secrets.JWT_SECRET) };
```

Load once at boot, pass into your service container. If you rotate often, wrap the fetch in a cache with TTL and re-fetch on 401.

### Rotation strategies

- **Append-only JWT keys.** Ship two keys at a time; sign with the newer one, accept either on verify. Remove the older key after the old signatures have expired.
- **Database credentials.** Support two concurrent users; cut over one instance at a time.
- **API keys to third parties.** Store both current and previous; rotate in your secrets manager, let the app pick up the new one on next fetch.

For the AWS specifics, see the [AWS deployment guide](./deploying-to-aws.md).

---

## 8. Dependency security

A typical Node app has 500–1500 transitive dependencies. Any one of them is a potential entry point.

### `npm audit` in CI

Triad's `.github/workflows/ci.yml` already runs `npm audit` on every PR. Fail the build on `critical`, warn on `high`. Don't let low/moderate block you — the signal-to-noise ratio is too low.

```yaml
- run: npm audit --audit-level=high
```

### Snyk and socket.dev

Alternatives with better remediation suggestions and behavioral analysis:

- **Snyk** catches known CVEs and suggests patches.
- **socket.dev** detects suspicious install-time behavior (network calls, filesystem writes, shell spawns) — useful for catching malicious packages before they land in your lockfile.

### Renovate and Dependabot

Automate the "keep everything up to date" work. Configure Renovate to:

- Group minor/patch updates into a single weekly PR.
- Raise majors as individual PRs with release notes.
- Auto-merge dev deps after CI passes.

Staying current is itself a security control — yesterday's zero-day is today's CVE with a fix, and the only way to apply the fix is to upgrade.

### Lockfile integrity

Commit `package-lock.json`. Use `npm ci` in CI, not `npm install`. `ci` fails if the lockfile and `package.json` disagree, catching drift that would otherwise sneak in during `install`.

### Vendoring native deps

If your Docker build compiles native modules (`better-sqlite3`, `sharp`, `argon2`), pin the versions and cache the compile step — otherwise a transitive bump silently changes binary output across builds and introduces non-reproducibility that makes incident response harder.

---

## 9. Observability as a security tool

Security monitoring is a subset of observability. You want to know when:

- Auth attempts spike (`beforeHandler` logs every failed login).
- 4xx/5xx rates jump on particular endpoints (metrics histograms with a `status` label).
- A particular IP or user is responsible for most of the failures (structured logs with client IP + user ID fields).
- Unusual latency patterns suggest a slow-loris or timing attack.

Wire up [`@triadjs/logging`](../../packages/logging/README.md) for structured logs, [`@triadjs/metrics`](../../packages/metrics/README.md) for request-level counters and histograms, and [`@triadjs/otel`](../../packages/otel/README.md) for distributed traces. Tag spans with caller identity when available so traces are useful during an incident.

The full observability walkthrough (including alert examples) lives in [`docs/guides/observability.md`](./observability.md).

---

## 10. OWASP Top 10 coverage audit

Walking through the 2021 OWASP Top 10 and how Triad + this cookbook address each:

### A01:2021 — Broken Access Control

The biggest risk. Triad's `checkOwnership` helper and the `beforeHandler` extension point give you one well-typed spot to enforce "does the caller own this record?" Use them on every endpoint that reads or mutates user-scoped data. See `packages/core/src/ownership.ts`.

### A02:2021 — Cryptographic Failures

Triad doesn't encrypt on your behalf. `@triadjs/jwt` wraps `jose` with secure defaults (RS256/ES256/EdDSA, no `alg: none`), but if you need to encrypt data at rest, use your database's encryption features or a KMS. For data in transit, HSTS and TLS termination at your load balancer cover the basics.

### A03:2021 — Injection

Triad's Zod-backed schema validation catches ~all shape and type injection vectors. What it doesn't do:
- Escape HTML (use your templating engine).
- Escape SQL (use Drizzle or another parameterized query library — see `@triadjs/drizzle`).
- Escape shell (use `spawn` with arg arrays).

### A04:2021 — Insecure Design

Triad's typed boundaries make many design failures visible at compile time. Using schemas and `checkOwnership` is itself a security control: it forces you to be explicit about ownership and shape at the moment you write the endpoint.

### A05:2021 — Security Misconfiguration

`@triadjs/security-headers` handles the most common HTTP-level misconfigurations. Other things to check:
- TLS configuration (use your load balancer's preset strict mode).
- Database default credentials changed.
- Debug endpoints removed from production builds.
- S3/GCS bucket permissions.

### A06:2021 — Vulnerable and Outdated Components

Covered by §8 above.

### A07:2021 — Identification and Authentication Failures

Covered by Phase 18 / [`@triadjs/jwt`](../../packages/jwt/README.md) and the [auth cookbook](./auth.md). Key points: rate limit auth endpoints aggressively (§3), use strong password hashing (argon2id or bcrypt with cost ≥ 12), and never roll your own session token format.

### A08:2021 — Software and Data Integrity Failures

- JWT signatures (`@triadjs/jwt`).
- HTTPS end-to-end.
- Sign and verify webhook payloads (HMAC with a shared secret, constant-time compare).
- Don't `npm install` from a URL without a hash.

### A09:2021 — Security Logging and Monitoring Failures

Covered by §9 above and Phase 14.

### A10:2021 — Server-Side Request Forgery

Covered by §6 (URL validation). Triad doesn't do this for you — if your app accepts URLs, you must validate them against an allowlist before fetching.

---

## 11. Pre-production security checklist

Run through this list before first production deploy, then again before every major change.

- [ ] `@triadjs/security-headers` middleware registered on every adapter instance.
- [ ] HTTPS enforced at load balancer; HSTS header set; `preload` considered (but only after subdomain audit).
- [ ] Rate limiting configured — tight on auth, looser on reads.
- [ ] CORS uses an explicit allowlist, not `'*'`, for any endpoint accepting credentials.
- [ ] Secrets loaded from env vars or a secrets manager, never checked into git.
- [ ] `.env` in `.gitignore`; `gitleaks`/`git-secrets` pre-commit hook configured.
- [ ] `npm audit --audit-level=high` is green in CI.
- [ ] `npm ci` (not `npm install`) used in deploy pipeline.
- [ ] Dependabot or Renovate configured for weekly updates.
- [ ] Auth endpoints have stricter rate limits than general endpoints.
- [ ] Password hashing uses argon2id or bcrypt (cost ≥ 12).
- [ ] JWT verification rejects `alg: none` and enforces expected algorithms.
- [ ] Error responses never leak stack traces or internal SQL.
- [ ] Logs structured via `@triadjs/logging`; sensitive fields (passwords, tokens, PII) are redacted.
- [ ] Every request body has a Triad schema; no handler uses `any` for input.
- [ ] Every response has a schema; Triad will catch shape drift at runtime.
- [ ] File uploads are size-bounded (`t.file().maxSize()`) and type-validated by magic bytes.
- [ ] Database queries parameterized — Drizzle handles this; raw SQL does not.
- [ ] Session cookies use `HttpOnly; Secure; SameSite=Strict` (or `Lax` when strict breaks UX).
- [ ] CSRF protection in place if using cookie auth.
- [ ] No `eval`, `new Function`, or `vm.runInThisContext` on user input.
- [ ] SSRF checks on any endpoint accepting URLs.
- [ ] CI runs tests + typecheck + audit on every PR.
- [ ] Deployment has a rollback plan; previous version can be restored in < 5 minutes.
- [ ] Error monitoring set up (Sentry / Datadog / Honeycomb) and alerting on 5xx spikes.
- [ ] Incident response runbook written; on-call rotation defined.
- [ ] Penetration test scheduled for 30 days after first prod deploy.

---

## 12. FAQ

**Q: Why not ship `@triadjs/cors` and `@triadjs/rate-limit`?**
The per-adapter ecosystems (`@fastify/cors`, `cors`, `hono/cors`, `@fastify/rate-limit`, `express-rate-limit`, `hono-rate-limiter`) are mature and well-maintained. Duplicating them in a Triad-branded wrapper would be lower quality than what exists, and would give you one more package to keep in sync. `@triadjs/security-headers` exists only because response headers are one of the few things Triad's `HandlerResponse` abstraction can't model — everything else, use the best-in-class adapter package.

**Q: Can I disable security headers for specific routes?**
In v1, no — the middleware applies to its scope. If you need one CSP for `/api` and another for `/public`, mount two instances on two scopes (e.g. two Fastify plugin registrations with different prefixes). Per-route overrides are a candidate for v-next.

**Q: What about a WAF (Web Application Firewall)?**
WAFs (Cloudflare, AWS WAF, GCP Armor) complement application-level defenses; they don't replace them. A WAF catches known attack patterns at the edge; Triad + this cookbook handle everything a WAF can't see because it doesn't understand your schemas. Use both.

**Q: Is `@triadjs/security-headers` enough for PCI-DSS / HIPAA / SOC2 compliance?**
No. Compliance is 80% organizational — policies, access controls, audit logs, employee training, vendor management — and 20% technical. This package covers a chunk of the technical surface for the HTTP layer, but it's one line in a long checklist. Get a compliance advisor before claiming anything.

**Q: How do I test security headers in my own test suite?**
supertest makes it easy:

```ts
await request(app).get('/').expect('X-Frame-Options', 'DENY');
```

For Fastify, `app.inject()` returns headers directly. For Hono, `app.fetch()` returns a `Response` with a `Headers` object. Every test in this package uses one of those three patterns — see `packages/security-headers/__tests__/` for examples.

**Q: My CSP breaks Google Fonts / Stripe / analytics.**
Add the vendor's origins to the relevant directives:

```ts
securityHeadersFastify({
  csp: {
    directives: {
      'script-src': ["'self'", 'https://js.stripe.com'],
      'frame-src': ['https://js.stripe.com', 'https://hooks.stripe.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
    },
  },
});
```

Start in `reportOnly: true` mode and tighten as the reports come in.

**Q: What's the difference between `frame-ancestors` and `X-Frame-Options`?**
`frame-ancestors` in CSP is the modern form — it supports multiple origins, wildcards, and is enforced by all current browsers. `X-Frame-Options` is the legacy form (`DENY` / `SAMEORIGIN`) kept for very old browsers. `@triadjs/security-headers` sets both by default; you lose nothing by keeping the legacy header and gain a small amount of back-compat.
