/**
 * Small helpers for plugging request context into
 * `withLoggingInstrumentation`. Ship what 90% of users need; anything
 * fancier is a one-liner in user code.
 */

/**
 * Build a `requestId` extractor that reads a header from the handler
 * context. Header lookup is case-insensitive.
 *
 * ```ts
 * withLoggingInstrumentation(router, {
 *   logger,
 *   requestId: requestIdFromHeader('x-request-id'),
 * });
 * ```
 */
export function requestIdFromHeader(
  headerName = 'x-request-id',
): (ctx: unknown) => string | undefined {
  const target = headerName.toLowerCase();
  return (ctx) => {
    if (ctx === null || typeof ctx !== 'object') return undefined;
    const headers = (ctx as { headers?: unknown }).headers;
    if (headers === null || typeof headers !== 'object') return undefined;
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) {
        return typeof value === 'string' ? value : undefined;
      }
    }
    return undefined;
  };
}
