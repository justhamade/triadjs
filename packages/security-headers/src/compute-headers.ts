import {
  DEFAULT_CSP,
  DEFAULT_HSTS,
  DEFAULT_PERMISSIONS_POLICY,
} from './defaults.js';
import type {
  CSPOptions,
  HSTSOptions,
  HeaderFactory,
  HeaderMap,
  PermissionsPolicyOptions,
  SecurityHeadersOptions,
} from './types.js';

/**
 * Build a header factory from `SecurityHeadersOptions`.
 *
 * Returned callable is either:
 *   - Static (`requiresNonce === false`): calling it returns the same
 *     frozen `HeaderMap` on every call — one allocation for the lifetime
 *     of the process.
 *   - Nonce-aware (`requiresNonce === true`): each call receives a
 *     per-request nonce and returns a fresh header map with the nonce
 *     woven into `script-src` and `style-src`.
 *
 * Throwing on missing nonce is intentional: adapter wrappers that
 * enable `csp.useNonce` must supply the nonce, otherwise the CSP
 * would silently ship without protection.
 */
export function computeHeaders(
  options: SecurityHeadersOptions = {},
): HeaderFactory {
  const cspOptions = resolveCsp(options.csp);
  const requiresNonce = cspOptions?.useNonce === true;

  if (!requiresNonce) {
    const frozen = Object.freeze(buildHeaders(options, cspOptions, undefined));
    const factory = ((_nonce?: string): HeaderMap => frozen) as HeaderFactory;
    Object.defineProperty(factory, 'requiresNonce', { value: false });
    return factory;
  }

  const factory = ((nonce?: string): HeaderMap => {
    if (typeof nonce !== 'string' || nonce.length === 0) {
      throw new Error(
        '@triadjs/security-headers: csp.useNonce is enabled but no nonce was supplied. ' +
          'Adapter wrappers must pass a fresh per-request nonce to the header factory.',
      );
    }
    return Object.freeze(buildHeaders(options, cspOptions, nonce));
  }) as HeaderFactory;
  Object.defineProperty(factory, 'requiresNonce', { value: true });
  return factory;
}

function resolveCsp(input: SecurityHeadersOptions['csp']): CSPOptions | undefined {
  if (input === false) return undefined;
  return input ?? {};
}

function buildHeaders(
  options: SecurityHeadersOptions,
  csp: CSPOptions | undefined,
  nonce: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (csp !== undefined) {
    const serialized = serializeCsp(csp, nonce);
    if (serialized.length > 0) {
      const headerName = csp.reportOnly
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy';
      headers[headerName] = serialized;
    }
  }

  if (options.hsts !== false) {
    headers['Strict-Transport-Security'] = serializeHsts(options.hsts);
  }

  const contentTypeOptions = options.contentTypeOptions ?? 'nosniff';
  if (contentTypeOptions !== false) {
    headers['X-Content-Type-Options'] = contentTypeOptions;
  }

  const frameOptions = options.frameOptions ?? 'DENY';
  if (frameOptions !== false) {
    headers['X-Frame-Options'] = frameOptions;
  }

  const referrerPolicy = options.referrerPolicy ?? 'strict-origin-when-cross-origin';
  if (referrerPolicy !== false) {
    headers['Referrer-Policy'] = referrerPolicy;
  }

  const permissionsPolicy =
    options.permissionsPolicy === undefined
      ? DEFAULT_PERMISSIONS_POLICY
      : options.permissionsPolicy;
  if (permissionsPolicy !== false) {
    headers['Permissions-Policy'] = serializePermissionsPolicy(permissionsPolicy);
  }

  const coop = options.coop ?? 'same-origin';
  if (coop !== false) {
    headers['Cross-Origin-Opener-Policy'] = coop;
  }

  const coep = options.coep ?? false;
  if (coep !== false) {
    headers['Cross-Origin-Embedder-Policy'] = coep;
  }

  const corp = options.corp ?? 'same-origin';
  if (corp !== false) {
    headers['Cross-Origin-Resource-Policy'] = corp;
  }

  return headers;
}

function serializeCsp(csp: CSPOptions, nonce: string | undefined): string {
  const merged = new Map<string, readonly string[] | true>();
  for (const [name, value] of Object.entries(DEFAULT_CSP)) {
    merged.set(name, value);
  }
  if (csp.directives) {
    for (const [name, value] of Object.entries(csp.directives)) {
      merged.set(name, value);
    }
  }

  if (nonce !== undefined) {
    for (const name of ['script-src', 'style-src'] as const) {
      const existing = merged.get(name);
      if (existing === undefined || existing === true) continue;
      merged.set(name, [...existing, `'nonce-${nonce}'`]);
    }
  }

  const parts: string[] = [];
  for (const [name, value] of merged) {
    if (value === true) {
      parts.push(name);
      continue;
    }
    if (value.length === 0) continue;
    parts.push(`${name} ${value.join(' ')}`);
  }
  return parts.join('; ');
}

function serializeHsts(options: HSTSOptions | undefined): string {
  const maxAge = options?.maxAge ?? DEFAULT_HSTS.maxAge;
  const includeSubDomains = options?.includeSubDomains ?? DEFAULT_HSTS.includeSubDomains;
  const preload = options?.preload ?? DEFAULT_HSTS.preload;

  const parts = [`max-age=${maxAge}`];
  if (includeSubDomains) parts.push('includeSubDomains');
  if (preload) parts.push('preload');
  return parts.join('; ');
}

function serializePermissionsPolicy(
  policy: PermissionsPolicyOptions,
): string {
  const parts: string[] = [];
  for (const [feature, allowlist] of Object.entries(policy.features)) {
    parts.push(`${feature}=${formatAllowlist(allowlist)}`);
  }
  return parts.join(', ');
}

function formatAllowlist(allowlist: readonly string[]): string {
  if (allowlist.length === 0) return '()';
  const tokens = allowlist.map((token) => {
    if (token === 'self' || token === 'src' || token === '*') return token;
    return `"${token}"`;
  });
  return `(${tokens.join(' ')})`;
}
