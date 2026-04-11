/**
 * Configuration shape for `@triad/security-headers`. Every field is
 * optional. Pass `false` to disable a header entirely; pass an object
 * to customize; omit a field to accept the default.
 */
export type SecurityHeadersOptions = {
  /** Content-Security-Policy. Pass `false` to disable. */
  csp?: CSPOptions | false;
  /** Strict-Transport-Security. Pass `false` to disable. */
  hsts?: HSTSOptions | false;
  /** X-Content-Type-Options. Default: `'nosniff'`. */
  contentTypeOptions?: 'nosniff' | false;
  /** X-Frame-Options. Default: `'DENY'`. */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Referrer-Policy. Default: `'strict-origin-when-cross-origin'`. */
  referrerPolicy?: ReferrerPolicy | false;
  /** Permissions-Policy. Default: minimal — disables geolocation, camera, mic, etc. */
  permissionsPolicy?: PermissionsPolicyOptions | false;
  /** Cross-Origin-Opener-Policy. Default: `'same-origin'`. */
  coop?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none' | false;
  /** Cross-Origin-Embedder-Policy. Default: disabled (breaks many apps). */
  coep?: 'require-corp' | 'credentialless' | 'unsafe-none' | false;
  /** Cross-Origin-Resource-Policy. Default: `'same-origin'`. */
  corp?: 'same-site' | 'same-origin' | 'cross-origin' | false;
  /** Remove X-Powered-By on every response. Default: `true`. */
  removePoweredBy?: boolean;
};

export type CSPOptions = {
  /**
   * Directive map. Keys are CSP directive names (e.g. `'script-src'`);
   * values are source lists, or `true` for boolean directives like
   * `'upgrade-insecure-requests'`. Provided directives are merged on
   * top of the defaults — pass an empty array to clear a directive.
   */
  directives?: Record<string, readonly string[] | true>;
  /** Emit as `Content-Security-Policy-Report-Only`. Default: `false`. */
  reportOnly?: boolean;
  /**
   * Automatically append a `'nonce-<value>'` source to `script-src` and
   * `style-src` on every request. When enabled, the adapter wrappers
   * generate a fresh nonce per request and expose it on the request
   * object. Default: `false`.
   */
  useNonce?: boolean;
};

export type HSTSOptions = {
  /** max-age in seconds. Default: `63072000` (2 years). */
  maxAge?: number;
  /** Include subdomains. Default: `true`. */
  includeSubDomains?: boolean;
  /** Opt into the HSTS preload list. Default: `false`. */
  preload?: boolean;
};

export type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

export type PermissionsPolicyOptions = {
  /**
   * Feature map: feature name → allowlist. An empty array means the
   * feature is disabled for all origins (same as `()` in HTTP syntax).
   * Tokens `self` and `src` are emitted unquoted; every other token is
   * treated as an origin and emitted quoted.
   *
   * Example:
   *   { camera: [], geolocation: ['self'], payment: ['self', 'https://pay.example.com'] }
   */
  features: Record<string, readonly string[]>;
};

/**
 * The set of headers produced by `computeHeaders`. Every value is a
 * serialized HTTP header string ready to write.
 */
export type HeaderMap = Readonly<Record<string, string>>;

/**
 * Callable returned by `computeHeaders`. When no nonce is relevant
 * (static config) calling with no arguments returns the same cached
 * object every time. When `csp.useNonce` is `true` the adapter MUST
 * supply a fresh nonce per request; calling without a nonce then
 * throws.
 */
export type HeaderFactory = {
  (nonce?: string): HeaderMap;
  /** `true` when the config requires a per-request nonce. */
  readonly requiresNonce: boolean;
};
