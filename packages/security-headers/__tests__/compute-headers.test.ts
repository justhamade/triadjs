import { describe, expect, it } from 'vitest';
import { computeHeaders } from '../src/compute-headers.js';

describe('computeHeaders — defaults', () => {
  it('produces the full default header set when called with no options', () => {
    const headers = computeHeaders()();
    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBeDefined();
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Embedder-Policy']).toBeUndefined();
  });

  it('default CSP contains every baseline directive', () => {
    const csp = computeHeaders()()['Content-Security-Policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    // boolean directive emits with no trailing value
    expect(csp).not.toContain('upgrade-insecure-requests true');
  });

  it('default permissions-policy disables features with empty allowlist', () => {
    const pp = computeHeaders()()['Permissions-Policy'] ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });
});

describe('computeHeaders — disabling individual headers', () => {
  it('csp:false omits Content-Security-Policy entirely', () => {
    const headers = computeHeaders({ csp: false })();
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('hsts:false omits Strict-Transport-Security', () => {
    const headers = computeHeaders({ hsts: false })();
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('contentTypeOptions:false omits X-Content-Type-Options', () => {
    const headers = computeHeaders({ contentTypeOptions: false })();
    expect(headers['X-Content-Type-Options']).toBeUndefined();
  });

  it('frameOptions:false omits X-Frame-Options', () => {
    const headers = computeHeaders({ frameOptions: false })();
    expect(headers['X-Frame-Options']).toBeUndefined();
  });
});

describe('computeHeaders — CSP customization', () => {
  it('custom script-src directive merges on top of defaults', () => {
    const headers = computeHeaders({
      csp: { directives: { 'script-src': ["'self'", 'https://cdn.example.com'] } },
    })();
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self' https://cdn.example.com");
    // other default directives survive
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it('reportOnly emits Content-Security-Policy-Report-Only instead', () => {
    const headers = computeHeaders({ csp: { reportOnly: true } })();
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBeDefined();
  });

  it('empty directive array clears the directive', () => {
    const headers = computeHeaders({
      csp: { directives: { 'upgrade-insecure-requests': [] } },
    })();
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('computeHeaders — HSTS customization', () => {
  it('custom maxAge is reflected', () => {
    const headers = computeHeaders({ hsts: { maxAge: 300 } })();
    expect(headers['Strict-Transport-Security']).toBe('max-age=300; includeSubDomains');
  });

  it('preload:true appends "; preload"', () => {
    const headers = computeHeaders({ hsts: { preload: true } })();
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
  });

  it('includeSubDomains:false omits the flag', () => {
    const headers = computeHeaders({ hsts: { includeSubDomains: false } })();
    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000');
  });
});

describe('computeHeaders — Permissions-Policy customization', () => {
  it('camera=["self"] emits camera=(self)', () => {
    const headers = computeHeaders({
      permissionsPolicy: { features: { camera: ['self'] } },
    })();
    expect(headers['Permissions-Policy']).toBe('camera=(self)');
  });

  it('empty allowlist emits feature=()', () => {
    const headers = computeHeaders({
      permissionsPolicy: { features: { camera: [] } },
    })();
    expect(headers['Permissions-Policy']).toBe('camera=()');
  });

  it('origin tokens are quoted', () => {
    const headers = computeHeaders({
      permissionsPolicy: {
        features: { payment: ['self', 'https://pay.example.com'] },
      },
    })();
    expect(headers['Permissions-Policy']).toBe(
      'payment=(self "https://pay.example.com")',
    );
  });
});

describe('computeHeaders — other headers', () => {
  it('frameOptions SAMEORIGIN', () => {
    const headers = computeHeaders({ frameOptions: 'SAMEORIGIN' })();
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('referrerPolicy override', () => {
    const headers = computeHeaders({ referrerPolicy: 'no-referrer' })();
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });

  it('coop, coep, corp each independently settable', () => {
    const headers = computeHeaders({
      coop: 'same-origin-allow-popups',
      coep: 'require-corp',
      corp: 'cross-origin',
    })();
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
  });
});

describe('computeHeaders — return shape', () => {
  it('removePoweredBy is not a header (adapter-side concern)', () => {
    const headers = computeHeaders({ removePoweredBy: false })();
    for (const name of Object.keys(headers)) {
      expect(name.toLowerCase()).not.toContain('powered-by');
    }
  });

  it('static factory returns the same frozen object on every call', () => {
    const factory = computeHeaders();
    const a = factory();
    const b = factory();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      (a as Record<string, string>)['X-Test'] = 'nope';
    }).toThrow();
  });

  it('requiresNonce is false for static config', () => {
    expect(computeHeaders().requiresNonce).toBe(false);
    expect(computeHeaders({ csp: { useNonce: false } }).requiresNonce).toBe(false);
  });

  it('requiresNonce is true when csp.useNonce is set', () => {
    expect(computeHeaders({ csp: { useNonce: true } }).requiresNonce).toBe(true);
  });

  it('nonce factory injects nonce into script-src and style-src', () => {
    const factory = computeHeaders({ csp: { useNonce: true } });
    const headers = factory('abc123');
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' 'nonce-abc123'");
  });

  it('nonce factory throws when called without a nonce', () => {
    const factory = computeHeaders({ csp: { useNonce: true } });
    expect(() => factory()).toThrow(/nonce/i);
  });

  it('two different nonces produce two different header maps', () => {
    const factory = computeHeaders({ csp: { useNonce: true } });
    const a = factory('nonce-one');
    const b = factory('nonce-two');
    expect(a['Content-Security-Policy']).not.toBe(b['Content-Security-Policy']);
  });
});
