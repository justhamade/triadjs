/**
 * Tests for the shared Swagger UI helper and the `DocsOption` contract
 * consumed by every HTTP adapter.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createRouter } from '@triadjs/core';
import {
  generateSwaggerUIHtml,
  generateAsyncAPIHtml,
  generateDocsLandingHtml,
  resolveDocsOption,
  escapeHtml,
  escapeJsString,
} from '../src/swagger-ui.js';

const router = createRouter({ title: 'Petstore API', version: '1.0.0' });

describe('escapeHtml', () => {
  it('escapes the five common HTML entities', () => {
    expect(escapeHtml('<p class="x">a & b</p>')).toBe(
      '&lt;p class=&quot;x&quot;&gt;a &amp; b&lt;/p&gt;',
    );
  });

  it('escapes single quotes as &#39;', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
});

describe('escapeJsString', () => {
  it('escapes backslashes and single quotes for a single-quoted JS literal', () => {
    expect(escapeJsString("it's")).toBe("it\\'s");
    expect(escapeJsString('a\\b')).toBe('a\\\\b');
  });

  it('breaks up a </script> sequence so the browser ignores it', () => {
    expect(escapeJsString('</script>')).toBe('<\\/script>');
    expect(escapeJsString('</SCRIPT>')).toBe('<\\/SCRIPT>');
  });

  it('escapes newlines', () => {
    expect(escapeJsString('a\nb\rc')).toBe('a\\nb\\rc');
  });
});

describe('generateSwaggerUIHtml', () => {
  it('produces an HTML document with the escaped title and spec URL', () => {
    const html = generateSwaggerUIHtml({
      title: 'Petstore API',
      openapiUrl: '/api-docs/openapi.json',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Petstore API — API docs</title>');
    expect(html).toContain("url: '/api-docs/openapi.json'");
    expect(html).toContain('SwaggerUIBundle');
  });

  it('pulls assets from jsdelivr pinned to v5 by default', () => {
    const html = generateSwaggerUIHtml({
      title: 'API',
      openapiUrl: '/api-docs/openapi.json',
    });
    expect(html).toContain(
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
    );
    expect(html).toContain(
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
    );
  });

  it('honors the swaggerUIVersion override', () => {
    const html = generateSwaggerUIHtml({
      title: 'API',
      openapiUrl: '/api-docs/openapi.json',
      swaggerUIVersion: '4.19.1',
    });
    expect(html).toContain('swagger-ui-dist@4.19.1/swagger-ui.css');
    expect(html).toContain('swagger-ui-dist@4.19.1/swagger-ui-bundle.js');
  });

  it('escapes a title that contains HTML to prevent injection', () => {
    const html = generateSwaggerUIHtml({
      title: '<script>alert(1)</script>',
      openapiUrl: '/api-docs/openapi.json',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a spec URL that contains a quote breaking out of the literal', () => {
    const html = generateSwaggerUIHtml({
      title: 'API',
      openapiUrl: "/x';alert(1);//",
    });
    // The raw injection attempt must not appear
    expect(html).not.toContain("/x';alert(1);//';");
    // The escaped form must appear
    expect(html).toContain("url: '/x\\';alert(1);//'");
  });
});

describe('resolveDocsOption', () => {
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
  });

  it('returns null when option is false', () => {
    expect(resolveDocsOption(false, router)).toBeNull();
  });

  it('returns defaults when option is true', () => {
    const resolved = resolveDocsOption(true, router);
    expect(resolved).toEqual({
      path: '/api-docs',
      title: 'Petstore API',
      swaggerUIVersion: '5',
    });
  });

  it('defaults to on when NODE_ENV is unset', () => {
    const resolved = resolveDocsOption(undefined, router);
    expect(resolved?.path).toBe('/api-docs');
    expect(resolved?.title).toBe('Petstore API');
  });

  it('defaults to on when NODE_ENV is development', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveDocsOption(undefined, router)?.path).toBe('/api-docs');
  });

  it('defaults to off in production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(resolveDocsOption(undefined, router)).toBeNull();
  });

  it('explicit true beats production default', () => {
    process.env['NODE_ENV'] = 'production';
    expect(resolveDocsOption(true, router)?.path).toBe('/api-docs');
  });

  it('explicit false beats dev default', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveDocsOption(false, router)).toBeNull();
  });

  it('accepts a custom path and falls back to the router title', () => {
    const resolved = resolveDocsOption({ path: '/docs' }, router);
    expect(resolved).toEqual({
      path: '/docs',
      title: 'Petstore API',
      swaggerUIVersion: '5',
    });
  });

  it('trims a trailing slash from the path', () => {
    expect(resolveDocsOption({ path: '/api-docs/' }, router)?.path).toBe(
      '/api-docs',
    );
  });

  it('preserves root path "/"', () => {
    expect(resolveDocsOption({ path: '/' }, router)?.path).toBe('/');
  });

  it('accepts a custom title and Swagger UI version', () => {
    const resolved = resolveDocsOption(
      { title: 'Custom Title', swaggerUIVersion: '4.18.0' },
      router,
    );
    expect(resolved?.title).toBe('Custom Title');
    expect(resolved?.swaggerUIVersion).toBe('4.18.0');
  });
});

describe('generateAsyncAPIHtml', () => {
  it('uses AsyncApiStandalone.render with the spec URL', () => {
    const html = generateAsyncAPIHtml({
      title: 'Petstore API',
      asyncapiUrl: '/api-docs/asyncapi.json',
    });
    // Uses the correct global — AsyncApiStandalone, NOT AsyncApiComponent
    expect(html).toContain('AsyncApiStandalone.render');
    expect(html).not.toContain('AsyncApiComponent');
    // Passes the spec URL so the component fetches it
    expect(html).toContain("url: '/api-docs/asyncapi.json'");
    // Loads the standalone bundle from unpkg
    expect(html).toContain('unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js');
  });

  it('loads Inter font from Google Fonts', () => {
    const html = generateAsyncAPIHtml({
      title: 'API',
      asyncapiUrl: '/x',
    });
    expect(html).toContain('fonts.googleapis.com/css2?family=Inter');
    expect(html).toContain("font-family: 'Inter'");
  });

  it('loads the AsyncAPI default stylesheet', () => {
    const html = generateAsyncAPIHtml({
      title: 'API',
      asyncapiUrl: '/x',
    });
    expect(html).toContain('unpkg.com/@asyncapi/react-component@latest/styles/default.min.css');
  });

  it('includes the title and correct HTML structure', () => {
    const html = generateAsyncAPIHtml({
      title: 'My WS API',
      asyncapiUrl: '/docs/asyncapi.json',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>My WS API — AsyncAPI docs</title>');
    expect(html).toContain('id="asyncapi"');
  });

  it('escapes title to prevent injection', () => {
    const html = generateAsyncAPIHtml({
      title: '<img onerror=alert(1)>',
      asyncapiUrl: '/x',
    });
    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('escapes the spec URL to prevent JS injection', () => {
    const html = generateAsyncAPIHtml({
      title: 'API',
      asyncapiUrl: "/x';alert(1);//",
    });
    expect(html).not.toContain("/x';alert(1);//'");
    expect(html).toContain("url: '/x\\';alert(1);//'");
  });
});

describe('generateDocsLandingHtml', () => {
  it('renders a landing page linking both HTTP and WebSocket docs', () => {
    const html = generateDocsLandingHtml({
      title: 'My API',
      openapiPath: '/api-docs/http',
      asyncapiPath: '/api-docs/ws',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>My API — API docs</title>');
    expect(html).toContain('href="/api-docs/http"');
    expect(html).toContain('href="/api-docs/ws"');
    expect(html).toContain('HTTP API');
    expect(html).toContain('WebSocket API');
  });
});
