import { randomBytes } from 'node:crypto';

/**
 * Generate a CSP nonce: 16 random bytes, base64-encoded. The base64
 * alphabet is CSP-safe when quoted (`'nonce-...'`), so no additional
 * escaping is needed.
 */
export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}
