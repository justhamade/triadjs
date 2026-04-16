/**
 * Swagger UI HTML template + `DocsOption` contract shared by the HTTP
 * adapters (`@triadjs/fastify`, `@triadjs/express`, `@triadjs/hono`).
 *
 * Every adapter accepts the same `DocsOption` shape and delegates the
 * default-state decision and HTML generation to this module. Keeping it
 * here (rather than duplicating across adapters) is the single biggest
 * thing preventing drift: a change to the default path, the Swagger UI
 * CDN version, or the HTML markup lands in one file and every adapter
 * picks it up on next build.
 *
 * The generated HTML pulls Swagger UI assets from `cdn.jsdelivr.net`
 * (pinned to a major version). That keeps `@triadjs/openapi` zero-
 * install — no 5MB `swagger-ui-dist` added to `node_modules`. For
 * offline dev servers, users can override the CDN version or supply
 * their own HTML by wrapping the adapter (a future escape hatch).
 */

import type { Router } from '@triadjs/core';

// ---------------------------------------------------------------------------
// Shared option contract
// ---------------------------------------------------------------------------

/**
 * Adapter `docs` option. Accepted verbatim by every HTTP adapter.
 *
 * - `undefined` (default): on when `NODE_ENV !== 'production'`, off otherwise
 * - `true`: on with defaults (`path: '/api-docs'`)
 * - `false`: off
 * - `{ path?, title?, swaggerUIVersion? }`: on with overrides
 *
 * The default state is evaluated at adapter registration time (when the
 * plugin/router factory runs), not per request, so setting `NODE_ENV`
 * after mounting has no effect.
 */
export type DocsOption =
  | boolean
  | {
      /** URL prefix where Swagger UI is served. Default: `/api-docs`. */
      path?: string;
      /** Title shown in `<title>` and the UI header. Default: the router's `title`. */
      title?: string;
      /** Override the Swagger UI CDN version. Default: `5`. */
      swaggerUIVersion?: string;
    };

/**
 * Concrete, fully-resolved docs config. `resolveDocsOption` normalizes
 * every `DocsOption` shape (plus the magic `undefined` default) into
 * this — or returns `null` when docs should be disabled.
 */
export interface ResolvedDocsConfig {
  path: string;
  title: string;
  swaggerUIVersion: string;
}

const DEFAULT_PATH = '/api-docs';
const DEFAULT_SWAGGER_UI_VERSION = '5';

/**
 * Resolve a `DocsOption` (including `undefined`) to a concrete config
 * the adapter can act on, or `null` when docs should be disabled.
 *
 * Every adapter calls this exactly once at registration time so all
 * three have identical semantics. Do not inline this logic into an
 * adapter — the default rules are the whole point of having a shared
 * contract.
 */
export function resolveDocsOption(
  option: DocsOption | undefined,
  router: Router,
): ResolvedDocsConfig | null {
  // Default: on outside production, off in production. The check runs
  // at registration time, not per request, so NODE_ENV changes after
  // the adapter is mounted have no effect.
  if (option === undefined) {
    const env =
      (typeof process !== 'undefined' &&
        process.env &&
        process.env['NODE_ENV']) ||
      '';
    if (env === 'production') return null;
    return {
      path: DEFAULT_PATH,
      title: router.config.title,
      swaggerUIVersion: DEFAULT_SWAGGER_UI_VERSION,
    };
  }

  if (option === false) return null;

  if (option === true) {
    return {
      path: DEFAULT_PATH,
      title: router.config.title,
      swaggerUIVersion: DEFAULT_SWAGGER_UI_VERSION,
    };
  }

  // Object form — fill in missing fields from defaults.
  return {
    path: normalizePath(option.path ?? DEFAULT_PATH),
    title: option.title ?? router.config.title,
    swaggerUIVersion: option.swaggerUIVersion ?? DEFAULT_SWAGGER_UI_VERSION,
  };
}

/**
 * Trim a trailing slash so `path + '/openapi.json'` produces a clean
 * URL regardless of how the user wrote their prefix. Leading slash is
 * preserved verbatim — the router owns routing, not this helper.
 */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

export interface SwaggerUIHtmlOptions {
  /** Title shown in `<title>` and the UI header. */
  title: string;
  /** Absolute or relative URL the UI loads its spec from. */
  openapiUrl: string;
  /** Swagger UI version to pull from jsdelivr. Defaults to `5`. */
  swaggerUIVersion?: string;
}

/**
 * Generate the Swagger UI HTML document that adapters serve at
 * `docs.path`. The HTML pulls `swagger-ui-dist` assets from jsdelivr
 * and initializes `SwaggerUIBundle({ url })` so the live OpenAPI JSON
 * at `${docs.path}/openapi.json` drives the UI.
 *
 * Every value interpolated into the HTML is escaped — `title` and
 * `openapiUrl` both come from user/router config and could contain
 * characters that break out of the HTML or JS contexts if written
 * verbatim.
 */
export function generateSwaggerUIHtml(options: SwaggerUIHtmlOptions): string {
  const version = options.swaggerUIVersion ?? DEFAULT_SWAGGER_UI_VERSION;
  const title = escapeHtml(options.title);
  const urlJs = escapeJsString(options.openapiUrl);
  const cssHref = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}/swagger-ui.css`;
  const jsSrc = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}/swagger-ui-bundle.js`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} — API docs</title>
    <link rel="stylesheet" href="${cssHref}">
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1460px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${jsSrc}" crossorigin></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '${urlJs}',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout',
        });
      });
    </script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// AsyncAPI Studio HTML
// ---------------------------------------------------------------------------

export interface AsyncAPIHtmlOptions {
  /** Title shown in `<title>`. */
  title: string;
  /** URL the component loads its spec from. */
  asyncapiUrl: string;
}

/**
 * Generate an HTML page that renders AsyncAPI documentation using the
 * official `@asyncapi/react-component` web component via CDN. Same
 * zero-install approach as the Swagger UI page — no npm package needed.
 */
export function generateAsyncAPIHtml(options: AsyncAPIHtmlOptions): string {
  const title = escapeHtml(options.title);
  const urlJs = escapeJsString(options.asyncapiUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} — AsyncAPI docs</title>
    <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@2/styles/default.min.css">
    <style>
      body { margin: 0; background: #fafafa; font-family: system-ui, sans-serif; }
      #asyncapi { max-width: 1460px; margin: 0 auto; padding: 2rem; }
    </style>
  </head>
  <body>
    <div id="asyncapi"></div>
    <script>
      (function () {
        var s = document.createElement('script');
        s.src = 'https://unpkg.com/@asyncapi/react-component@2/browser/standalone/index.js';
        s.crossOrigin = 'anonymous';
        s.onload = function () {
          fetch('${urlJs}')
            .then(function (r) { return r.text(); })
            .then(function (schema) {
              AsyncApiComponent.render(
                { schema: schema, config: { show: { sidebar: true } } },
                document.getElementById('asyncapi')
              );
            });
        };
        document.head.appendChild(s);
      })();
    </script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Docs landing page (when both OpenAPI and AsyncAPI are present)
// ---------------------------------------------------------------------------

export interface DocsLandingHtmlOptions {
  title: string;
  openapiPath: string;
  asyncapiPath: string;
}

/**
 * A minimal landing page that links to both Swagger UI (HTTP) and the
 * AsyncAPI viewer (WebSocket). Only generated when the router has both
 * endpoints and channels; when only HTTP endpoints exist, the adapter
 * serves Swagger UI directly at `docs.path`.
 */
export function generateDocsLandingHtml(options: DocsLandingHtmlOptions): string {
  const title = escapeHtml(options.title);
  const openapi = escapeHtml(options.openapiPath);
  const asyncapi = escapeHtml(options.asyncapiPath);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} — API docs</title>
    <style>
      * { box-sizing: border-box; margin: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; background: #fafafa; color: #333; }
      .container { max-width: 720px; margin: 80px auto; padding: 0 24px; }
      h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
      p { color: #666; margin-bottom: 2rem; }
      .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
      .card {
        display: block; padding: 2rem; background: #fff; border: 1px solid #e5e7eb;
        border-radius: 12px; text-decoration: none; color: inherit;
        transition: box-shadow 0.15s, border-color 0.15s;
      }
      .card:hover { border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59,130,246,0.15); }
      .card h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
      .card span { font-size: 0.875rem; color: #666; }
      @media (max-width: 520px) { .cards { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${title}</h1>
      <p>Choose a protocol to explore the API documentation.</p>
      <div class="cards">
        <a class="card" href="${openapi}">
          <h2>HTTP API</h2>
          <span>OpenAPI 3.1 &middot; Swagger UI</span>
        </a>
        <a class="card" href="${asyncapi}">
          <h2>WebSocket API</h2>
          <span>AsyncAPI 3.0 &middot; Channels</span>
        </a>
      </div>
    </div>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

/**
 * HTML-escape a string for text and attribute contexts. The output is
 * safe to interpolate into either a text node or a double-quoted
 * attribute value.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a string for a single-quoted JavaScript literal. Backslashes
 * and quotes become `\\` and `\'`; `</script>` sequences are broken up
 * so the browser doesn't treat them as a closing tag.
 */
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    // Preserve the original case of `script` / `SCRIPT` so the
    // browser still can't see `</script>` but debugging is unsurprising.
    .replace(/<\/script/gi, (m) => '<\\' + m.slice(1));
}
