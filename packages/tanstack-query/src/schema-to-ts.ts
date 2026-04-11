/**
 * Convert Triad `SchemaNode`s into TypeScript type strings.
 *
 * The emitter walks a schema and produces a TS type expression. For
 * named models and value objects, a reference to the emitted interface
 * name is produced and the interface is registered for top-level
 * emission via {@link TypeEmitter.registerNamed}.
 */

import { SchemaNode, type ModelShape } from '@triad/core';

// NOTE on module-graph safety:
//
// We intentionally dispatch on `node.kind` (the discriminant string on
// every SchemaNode) rather than `instanceof`. The CLI loads the user's
// router via jiti which may resolve `@triad/core` through a different
// copy than the one imported here; `instanceof` breaks across copies
// whereas `kind` is stable because every schema constructor sets it to
// a string literal.

interface NamedNode extends SchemaNode {
  readonly name: string;
  readonly shape?: ModelShape;
  readonly inner?: SchemaNode | ModelShape;
}

interface EnumNode extends SchemaNode {
  readonly values: readonly string[];
}

interface LiteralNode extends SchemaNode {
  readonly value: string | number | boolean;
}

interface ArrayNode extends SchemaNode {
  readonly item: SchemaNode;
}

interface RecordNode extends SchemaNode {
  readonly valueSchema: SchemaNode;
}

interface TupleNode extends SchemaNode {
  readonly items: readonly SchemaNode[];
}

interface UnionNode extends SchemaNode {
  readonly options: readonly SchemaNode[];
}

export interface NamedType {
  name: string;
  /** Rendered TypeScript interface body (incl. leading doc + export). */
  source: string;
}

/**
 * Shared state across emission of a router: tracks named models/values
 * seen so far so that (a) we only emit each interface once and (b) the
 * final `types.ts` file contains every referenced named type.
 */
export class TypeEmitter {
  private readonly emitted = new Map<string, NamedType>();
  /** Names currently being emitted (cycle guard). */
  private readonly inProgress = new Set<string>();

  /** All named types emitted so far, in registration order. */
  namedTypes(): NamedType[] {
    return Array.from(this.emitted.values());
  }

  /** True if a named type with this name is already registered. */
  has(name: string): boolean {
    return this.emitted.has(name);
  }

  /**
   * Emit a standalone named interface from an anonymous/synthetic model
   * (e.g. an endpoint's normalized `params` / `query` / `headers`
   * ModelSchema). The caller controls the `name` used.
   */
  emitNamedFromShape(name: string, shape: ModelShape, description?: string): void {
    if (this.emitted.has(name) || this.inProgress.has(name)) return;
    this.inProgress.add(name);
    const source = this.buildInterface(name, shape, description);
    this.emitted.set(name, { name, source });
    this.inProgress.delete(name);
  }

  /**
   * Emit a TS type expression for a schema node. Recursively registers
   * any named models/values encountered.
   */
  emitType(node: SchemaNode): string {
    const base = this.emitTypeInner(node);
    if (node.isNullable) {
      return `(${base}) | null`;
    }
    return base;
  }

  private emitTypeInner(node: SchemaNode): string {
    switch (node.kind) {
      case 'model': {
        const model = node as NamedNode;
        this.ensureNamedShape(model.name, model.shape as ModelShape, node.metadata.description);
        return model.name;
      }
      case 'value':
        return this.emitValue(node as NamedNode);
      case 'empty':
        return 'void';
      case 'string':
      case 'datetime':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'enum': {
        const values = (node as EnumNode).values;
        return values.map((v) => JSON.stringify(v)).join(' | ');
      }
      case 'literal':
        return JSON.stringify((node as LiteralNode).value);
      case 'unknown':
        return 'unknown';
      case 'array': {
        const item = (node as ArrayNode).item;
        const inner = this.emitType(item);
        return needsParens(inner) ? `Array<${inner}>` : `${inner}[]`;
      }
      case 'record': {
        const inner = this.emitType((node as RecordNode).valueSchema);
        return `Record<string, ${inner}>`;
      }
      case 'tuple': {
        const items = (node as TupleNode).items;
        return `[${items.map((i) => this.emitType(i)).join(', ')}]`;
      }
      case 'union': {
        const options = (node as UnionNode).options;
        return options.map((o) => this.emitType(o)).join(' | ');
      }
      default:
        return 'unknown';
    }
  }

  private emitValue(node: NamedNode): string {
    const inner = node.inner;
    if (inner !== undefined && isSchemaNodeLike(inner)) {
      // Transparent alias over a primitive — inline its type.
      return this.emitType(inner);
    }
    if (inner === undefined) return 'unknown';
    this.ensureNamedShape(node.name, inner as ModelShape, node.metadata.description);
    return node.name;
  }

  private ensureNamedShape(name: string, shape: ModelShape, description?: string): void {
    if (this.emitted.has(name) || this.inProgress.has(name)) return;
    this.inProgress.add(name);
    const source = this.buildInterface(name, shape, description);
    this.emitted.set(name, { name, source });
    this.inProgress.delete(name);
  }

  private buildInterface(
    name: string,
    shape: ModelShape,
    description?: string,
  ): string {
    const lines: string[] = [];
    if (description !== undefined && description.length > 0) {
      lines.push(`/** ${escapeJsDoc(description)} */`);
    }
    lines.push(`export interface ${name} {`);
    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      const fieldType = this.emitType(fieldSchema);
      const optional = fieldSchema.isOptional ? '?' : '';
      const doc = fieldSchema.metadata.description;
      if (doc !== undefined && doc.length > 0) {
        lines.push(`  /** ${escapeJsDoc(doc)} */`);
      }
      lines.push(`  ${safeKey(fieldName)}${optional}: ${fieldType};`);
    }
    lines.push('}');
    return lines.join('\n');
  }
}

function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function safeKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function needsParens(type: string): boolean {
  // Array notation `T[]` breaks on unions / intersections; fall back to Array<T>.
  return /[|&]/.test(type);
}

function isSchemaNodeLike(value: unknown): value is SchemaNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { _validateAt?: unknown })._validateAt === 'function'
  );
}
