/**
 * Shared schemas used by multiple bounded contexts.
 *
 * `Money` is a DDD value object — immutable, identity-less, compared by
 * value. It demonstrates how Triad's `t.value()` produces inline OpenAPI
 * schemas instead of `$ref` components (value objects describe attributes,
 * not resources). We store monetary amounts as integer cents to avoid the
 * precision issues that plague `float` currencies.
 *
 * `ApiError` is Triad's recommended error body shape. Every error response
 * uses it so clients can parse errors uniformly.
 */

import { t } from '@triad/core';

export const Money = t.value('Money', {
  amount: t
    .int32()
    .min(0)
    .doc('Amount in cents (e.g. $12.50 → 1250)')
    .example(1500),
  currency: t.enum('USD', 'CAD', 'EUR').doc('ISO 4217 currency code'),
});

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code').example('NOT_FOUND'),
  message: t.string().doc('Human-readable error message'),
  details: t
    .record(t.string(), t.unknown())
    .optional()
    .doc('Additional context about the error'),
});
