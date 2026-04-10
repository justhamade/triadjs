/**
 * Serialize an AsyncAPIDocument to YAML or JSON.
 */

import { stringify as yamlStringify } from 'yaml';
import type { AsyncAPIDocument } from './generator.js';

/** Serialize to AsyncAPI-compatible YAML. */
export function toYaml(doc: AsyncAPIDocument): string {
  return yamlStringify(doc, {
    indent: 2,
    lineWidth: 0, // don't wrap long strings
  });
}

/** Serialize to JSON (pretty-printed by default). */
export function toJson(doc: AsyncAPIDocument, indent = 2): string {
  return JSON.stringify(doc, null, indent);
}
