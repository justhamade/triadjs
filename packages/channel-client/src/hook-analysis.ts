/**
 * Shared channel analysis utilities for framework hook generators.
 *
 * Extracts the duplicated name-conversion, type-reference-collection,
 * and channel-analysis logic that was previously copied across the
 * React, Solid, Vue, and Svelte hook generators.
 *
 * This module is framework-agnostic — it analyses a `Channel` object
 * and produces a `ChannelHookAnalysis` that each generator consumes
 * to emit its framework-specific hook/factory code.
 */

import type { Channel, SchemaNode } from '@triad/core';
import type { TypeEmitter } from '@triad/tanstack-query';

// ---------------------------------------------------------------------------
// Name conversion
// ---------------------------------------------------------------------------

/** Convert a camelCase, kebab-case, or snake_case name to PascalCase. */
export function toPascalCase(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Convert a camelCase name to camelCase (lowercase-first PascalCase). */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Convert a camelCase or PascalCase name to kebab-case. */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

/** Derive a handler callback name from a message type: `'review'` -> `'onReview'`. */
export function messageToHandlerName(messageType: string): string {
  return `on${toPascalCase(messageType)}`;
}

// ---------------------------------------------------------------------------
// Type reference collection
// ---------------------------------------------------------------------------

/** Matches PascalCase identifiers that might be user-defined type references. */
export const TYPE_REF_RE = /\b([A-Z][A-Za-z0-9_]*)\b/g;

/** Built-in TypeScript / JS global types that should NOT be treated as imports. */
export const BUILTIN: ReadonlySet<string> = new Set([
  'Array',
  'Record',
  'Partial',
  'Readonly',
  'ReadonlyArray',
  'Promise',
  'Map',
  'Set',
  'Date',
  'Buffer',
  'Uint8Array',
  'ArrayBuffer',
]);

/**
 * Scan a TypeScript type string for PascalCase references and add
 * non-builtin names to `out`.
 */
export function collectTypeRefs(type: string, out: Set<string>): void {
  let match: RegExpExecArray | null;
  TYPE_REF_RE.lastIndex = 0;
  while ((match = TYPE_REF_RE.exec(type)) !== null) {
    const ref = match[1]!;
    if (!BUILTIN.has(ref)) out.add(ref);
  }
}

/**
 * Walk an inline shape (connection params/query/headers) through the
 * TypeEmitter to register named models and collect type references.
 */
export function walkInlineShape(
  emitter: TypeEmitter,
  model:
    | {
        readonly shape?: Record<string, SchemaNode>;
      }
    | undefined,
  typeImports: Set<string>,
): void {
  if (!model || !model.shape) return;
  for (const fieldSchema of Object.values(model.shape)) {
    const typeStr = emitter.emitType(fieldSchema);
    collectTypeRefs(typeStr, typeImports);
  }
}

// ---------------------------------------------------------------------------
// Channel analysis
// ---------------------------------------------------------------------------

/** Describes a single message (client or server) in a channel. */
export interface MsgRef {
  /** The message type key (e.g. `'submitReview'`). */
  type: string;
  /** The TypeScript type string emitted by `TypeEmitter`. */
  tsType: string;
}

/** Framework-agnostic analysis of a channel for hook generation. */
export interface ChannelHookAnalysis {
  /** PascalCase channel name for hook/factory naming. */
  pascal: string;
  /** camelCase channel name (lowercase-first PascalCase). */
  camel: string;
  /** kebab-case channel name for file naming. */
  kebab: string;
  /** Client messages (what the user can send). */
  clientMessages: readonly MsgRef[];
  /** Server messages (what the user receives). */
  serverMessages: readonly MsgRef[];
  /** Whether the channel has any client messages. */
  hasClientMessages: boolean;
  /** Whether the channel has any server messages. */
  hasServerMessages: boolean;
  /** Whether a server message named `'error'` exists (collision with lifecycle error). */
  hasErrorMessage: boolean;
  /** All type references needed in the generated file's import block, sorted. */
  typeImports: readonly string[];
}

/**
 * Analyse a channel and produce a framework-agnostic summary used by
 * each hook generator to emit its framework-specific code.
 */
export function analyzeChannel(
  channel: Channel,
  emitter: TypeEmitter,
): ChannelHookAnalysis {
  const pascal = toPascalCase(channel.name);
  const camel = toCamelCase(channel.name);
  const kebab = toKebabCase(channel.name);
  const typeImportSet = new Set<string>();

  walkInlineShape(emitter, channel.connection.params, typeImportSet);
  walkInlineShape(emitter, channel.connection.query, typeImportSet);
  walkInlineShape(emitter, channel.connection.headers, typeImportSet);

  const clientMessages: MsgRef[] = [];
  for (const [type, config] of Object.entries(channel.clientMessages)) {
    const tsType = emitter.emitType(config.schema);
    collectTypeRefs(tsType, typeImportSet);
    clientMessages.push({ type, tsType });
  }

  const serverMessages: MsgRef[] = [];
  for (const [type, config] of Object.entries(channel.serverMessages)) {
    const tsType = emitter.emitType(config.schema);
    collectTypeRefs(tsType, typeImportSet);
    serverMessages.push({ type, tsType });
  }

  return {
    pascal,
    camel,
    kebab,
    clientMessages,
    serverMessages,
    hasClientMessages: clientMessages.length > 0,
    hasServerMessages: serverMessages.length > 0,
    hasErrorMessage: serverMessages.some((m) => m.type === 'error'),
    typeImports: Array.from(typeImportSet).sort(),
  };
}
