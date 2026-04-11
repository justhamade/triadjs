import type { SecurityHeadersOptions } from './types.js';

/**
 * Default Content-Security-Policy directive set. Mirrors Helmet's
 * opinionated baseline with small adjustments. Inline styles are
 * allowed because most real applications still ship at least one
 * `style=""` attribute; tighten this if you can.
 */
export const DEFAULT_CSP: Readonly<Record<string, readonly string[] | true>> = Object.freeze({
  'default-src': Object.freeze(["'self'"]),
  'base-uri': Object.freeze(["'self'"]),
  'font-src': Object.freeze(["'self'", 'https:', 'data:']),
  'form-action': Object.freeze(["'self'"]),
  'frame-ancestors': Object.freeze(["'self'"]),
  'img-src': Object.freeze(["'self'", 'data:']),
  'object-src': Object.freeze(["'none'"]),
  'script-src': Object.freeze(["'self'"]),
  'script-src-attr': Object.freeze(["'none'"]),
  'style-src': Object.freeze(["'self'", "'unsafe-inline'"]),
  'upgrade-insecure-requests': true,
});

export const DEFAULT_HSTS = Object.freeze({
  maxAge: 63072000,
  includeSubDomains: true,
  preload: false,
});

export const DEFAULT_PERMISSIONS_POLICY = Object.freeze({
  features: Object.freeze({
    accelerometer: Object.freeze([] as readonly string[]),
    camera: Object.freeze([] as readonly string[]),
    geolocation: Object.freeze([] as readonly string[]),
    gyroscope: Object.freeze([] as readonly string[]),
    magnetometer: Object.freeze([] as readonly string[]),
    microphone: Object.freeze([] as readonly string[]),
    payment: Object.freeze([] as readonly string[]),
    usb: Object.freeze([] as readonly string[]),
    'interest-cohort': Object.freeze([] as readonly string[]),
  }),
});

/**
 * A minimal starter config — just the non-controversial headers. Users
 * whose apps have unusual constraints can import this and extend it
 * instead of relying on the full opinionated defaults.
 */
export const MINIMAL_OPTIONS: SecurityHeadersOptions = Object.freeze({
  csp: false,
  hsts: { maxAge: 63072000 },
  contentTypeOptions: 'nosniff',
  frameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: false,
  coop: 'same-origin',
  coep: false,
  corp: 'same-origin',
  removePoweredBy: true,
});
