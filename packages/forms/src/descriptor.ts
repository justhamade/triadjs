/**
 * Walk a Triad `SchemaNode` tree and emit a compact JSON descriptor
 * suitable for embedding as a `const` in generated frontend code.
 *
 * The descriptor is the minimal shape needed by `runtime.ts` to
 * validate a form-submission payload: required/optional, the field
 * type, enum values, and the nested shape for sub-models. It is
 * deliberately small so the bundled runtime can parse it without
 * pulling in `@triad/core`.
 *
 * Dispatch is by `kind` string (NOT `instanceof`) so two copies of
 * `@triad/core` loaded via different module graphs still produce the
 * same descriptor — the same pattern used by the tanstack-query
 * emitter.
 */

import type { SchemaNode } from '@triad/core';

export type FormFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'literal'
  | 'array'
  | 'object'
  | 'unknown';

export interface FormFieldDesc {
  kind: FormFieldKind;
  optional: boolean;
  nullable: boolean;
  /** For `enum`. */
  values?: readonly (string | number)[];
  /** For `literal`. */
  literal?: string | number | boolean;
  /** For `array`. */
  item?: FormFieldDesc;
  /** For `object` / nested models. */
  fields?: Record<string, FormFieldDesc>;
}

interface NamedNode extends SchemaNode {
  readonly shape?: Record<string, SchemaNode>;
  readonly item?: SchemaNode;
  readonly values?: readonly string[];
  readonly value?: string | number | boolean;
}

export function describeSchema(node: SchemaNode): FormFieldDesc {
  const desc: FormFieldDesc = {
    kind: mapKind(node.kind),
    optional: node.isOptional,
    nullable: node.isNullable,
  };

  switch (node.kind) {
    case 'model': {
      const shape = (node as NamedNode).shape;
      if (shape !== undefined) {
        desc.kind = 'object';
        desc.fields = {};
        for (const [k, v] of Object.entries(shape)) {
          desc.fields[k] = describeSchema(v);
        }
      }
      return desc;
    }
    case 'array': {
      const item = (node as NamedNode).item;
      if (item !== undefined) {
        desc.item = describeSchema(item);
      }
      return desc;
    }
    case 'enum': {
      const values = (node as NamedNode).values;
      if (values !== undefined) {
        desc.values = values.slice();
      }
      return desc;
    }
    case 'literal': {
      const value = (node as NamedNode).value;
      if (value !== undefined) {
        desc.literal = value;
      }
      return desc;
    }
    default:
      return desc;
  }
}

function mapKind(kind: string): FormFieldKind {
  switch (kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
      return 'datetime';
    case 'enum':
      return 'enum';
    case 'literal':
      return 'literal';
    case 'array':
      return 'array';
    case 'model':
    case 'value':
      return 'object';
    default:
      return 'unknown';
  }
}
