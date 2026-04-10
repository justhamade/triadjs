/**
 * Serialize an OpenAPIDocument to YAML or JSON.
 */

import { stringify as yamlStringify } from 'yaml';
import type { OpenAPIDocument } from './generator.js';

/** Serialize to OpenAPI-compatible YAML. */
export function toYaml(doc: OpenAPIDocument): string {
  return yamlStringify(doc, {
    indent: 2,
    lineWidth: 0, // don't wrap long strings
  });
}

/** Serialize to JSON (pretty-printed by default). */
export function toJson(doc: OpenAPIDocument, indent = 2): string {
  return JSON.stringify(doc, null, indent);
}
