/**
 * OpenAPI document diff — a small, opinionated breaking-change
 * detector for `triad docs check`.
 *
 * Scope (v1):
 *   - endpoint added / removed
 *   - method added / removed
 *   - response status added / removed
 *   - response schema fields added / removed / required-ized
 *   - request body fields added / removed / required-ized
 *   - enum values added / removed / reordered
 *
 * Punted on:
 *   - deep oneOf/anyOf/allOf structural comparisons (flagged "risky")
 *   - parameter schema type changes (flagged "risky")
 *   - security scheme changes
 *
 * The diff walker is deliberately untyped — real OpenAPI docs are
 * loose enough (ref resolution, inline vs named schemas, optional
 * fields everywhere) that pretending to have a tight type here would
 * create more friction than it removes. We treat the input as
 * `Record<string, unknown>` and narrow on access.
 */

export type Severity = 'safe' | 'risky' | 'breaking';

export interface DiffChange {
  readonly severity: Severity;
  readonly path: string;
  readonly message: string;
}

export interface DiffResult {
  readonly safe: DiffChange[];
  readonly risky: DiffChange[];
  readonly breaking: DiffChange[];
}

type JsonObj = Record<string, unknown>;

function obj(v: unknown): JsonObj | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObj) : undefined;
}

function arr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

class Collector {
  readonly changes: DiffChange[] = [];
  add(severity: Severity, path: string, message: string): void {
    this.changes.push({ severity, path, message });
  }
}

export function diffOpenAPI(
  baseline: unknown,
  current: unknown,
): DiffResult {
  const col = new Collector();
  const base = obj(baseline) ?? {};
  const next = obj(current) ?? {};
  diffPaths(obj(base.paths) ?? {}, obj(next.paths) ?? {}, col);
  const result: DiffResult = {
    safe: col.changes.filter((c) => c.severity === 'safe'),
    risky: col.changes.filter((c) => c.severity === 'risky'),
    breaking: col.changes.filter((c) => c.severity === 'breaking'),
  };
  return result;
}

function diffPaths(base: JsonObj, next: JsonObj, col: Collector): void {
  const baseKeys = new Set(Object.keys(base));
  const nextKeys = new Set(Object.keys(next));

  for (const key of nextKeys) {
    if (!baseKeys.has(key)) {
      col.add('safe', key, `New endpoint added: ${key}`);
      continue;
    }
    diffPathItem(key, obj(base[key]) ?? {}, obj(next[key]) ?? {}, col);
  }
  for (const key of baseKeys) {
    if (!nextKeys.has(key)) {
      col.add('breaking', key, `Endpoint removed: ${key}`);
    }
  }
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

function diffPathItem(
  pathKey: string,
  base: JsonObj,
  next: JsonObj,
  col: Collector,
): void {
  for (const method of HTTP_METHODS) {
    const b = obj(base[method]);
    const n = obj(next[method]);
    const scope = `${method.toUpperCase()} ${pathKey}`;
    if (!b && n) {
      col.add('safe', scope, `New method added: ${scope}`);
      continue;
    }
    if (b && !n) {
      col.add('breaking', scope, `Method removed: ${scope}`);
      continue;
    }
    if (b && n) {
      diffOperation(scope, b, n, col);
    }
  }
}

function diffOperation(
  scope: string,
  base: JsonObj,
  next: JsonObj,
  col: Collector,
): void {
  diffRequestBody(scope, obj(base.requestBody), obj(next.requestBody), col);
  diffResponses(scope, obj(base.responses) ?? {}, obj(next.responses) ?? {}, col);
  diffParameters(scope, arr(base.parameters) ?? [], arr(next.parameters) ?? [], col);
}

function diffRequestBody(
  scope: string,
  base: JsonObj | undefined,
  next: JsonObj | undefined,
  col: Collector,
): void {
  if (!base && !next) return;
  if (!base && next) {
    const required = next.required === true;
    col.add(
      required ? 'breaking' : 'safe',
      scope,
      required
        ? `New required requestBody added on ${scope}`
        : `New optional requestBody added on ${scope}`,
    );
    return;
  }
  if (base && !next) {
    col.add('risky', scope, `requestBody removed from ${scope}`);
    return;
  }
  if (!base || !next) return;
  const baseSchema = extractJsonSchema(obj(base.content));
  const nextSchema = extractJsonSchema(obj(next.content));
  if (baseSchema && nextSchema) {
    diffSchema(`${scope} request`, baseSchema, nextSchema, col, 'request');
  }
}

function diffResponses(
  scope: string,
  base: JsonObj,
  next: JsonObj,
  col: Collector,
): void {
  const baseKeys = new Set(Object.keys(base));
  const nextKeys = new Set(Object.keys(next));
  for (const status of nextKeys) {
    if (!baseKeys.has(status)) {
      col.add('safe', scope, `New response status ${status} added on ${scope}`);
      continue;
    }
    const b = obj(base[status]) ?? {};
    const n = obj(next[status]) ?? {};
    const baseSchema = extractJsonSchema(obj(b.content));
    const nextSchema = extractJsonSchema(obj(n.content));
    if (baseSchema && nextSchema) {
      diffSchema(
        `${scope} ${status}`,
        baseSchema,
        nextSchema,
        col,
        'response',
      );
    }
  }
  for (const status of baseKeys) {
    if (!nextKeys.has(status)) {
      col.add('breaking', scope, `Response status ${status} removed from ${scope}`);
    }
  }
}

function diffParameters(
  scope: string,
  base: unknown[],
  next: unknown[],
  col: Collector,
): void {
  const byKey = (p: unknown): string => {
    const o = obj(p);
    return `${String(o?.in ?? '')}:${String(o?.name ?? '')}`;
  };
  const baseMap = new Map(base.map((p) => [byKey(p), obj(p) ?? {}]));
  const nextMap = new Map(next.map((p) => [byKey(p), obj(p) ?? {}]));
  for (const [key, n] of nextMap) {
    if (!baseMap.has(key)) {
      const required = n.required === true;
      col.add(
        required ? 'breaking' : 'safe',
        scope,
        `New ${required ? 'required' : 'optional'} parameter ${key} on ${scope}`,
      );
      continue;
    }
    const b = baseMap.get(key)!;
    if (b.required !== true && n.required === true) {
      col.add('breaking', scope, `Parameter ${key} became required on ${scope}`);
    }
  }
  for (const [key] of baseMap) {
    if (!nextMap.has(key)) {
      col.add('risky', scope, `Parameter ${key} removed from ${scope}`);
    }
  }
}

function extractJsonSchema(content: JsonObj | undefined): JsonObj | undefined {
  if (!content) return undefined;
  const json = obj(content['application/json']);
  if (!json) {
    // Fallback: first available content type.
    for (const v of Object.values(content)) {
      const o = obj(v);
      if (o?.schema) return obj(o.schema);
    }
    return undefined;
  }
  return obj(json.schema);
}

type Direction = 'request' | 'response';

function diffSchema(
  scope: string,
  base: JsonObj,
  next: JsonObj,
  col: Collector,
  direction: Direction,
): void {
  // Enum diffs.
  const baseEnum = arr(base.enum);
  const nextEnum = arr(next.enum);
  if (baseEnum && nextEnum) {
    const baseSet = new Set(baseEnum.map(String));
    const nextSet = new Set(nextEnum.map(String));
    for (const v of nextSet) {
      if (!baseSet.has(v)) {
        col.add('safe', scope, `Enum value ${JSON.stringify(v)} added on ${scope}`);
      }
    }
    for (const v of baseSet) {
      if (!nextSet.has(v)) {
        col.add(
          'breaking',
          scope,
          `Enum value ${JSON.stringify(v)} removed on ${scope}`,
        );
      }
    }
    // Reorder check: same values, different order → risky.
    if (
      baseEnum.length === nextEnum.length &&
      baseEnum.every((_, i) => String(baseEnum[i]) === String(nextEnum[i])) === false &&
      baseEnum.every((v) => nextSet.has(String(v)))
    ) {
      col.add('risky', scope, `Enum values reordered on ${scope}`);
    }
  }

  // Type changes → risky.
  if (base.type !== next.type && base.type !== undefined && next.type !== undefined) {
    col.add('risky', scope, `Type changed on ${scope}: ${String(base.type)} → ${String(next.type)}`);
  }

  // Object property diffs.
  const baseProps = obj(base.properties);
  const nextProps = obj(next.properties);
  const baseRequired = new Set((arr(base.required) ?? []).map(String));
  const nextRequired = new Set((arr(next.required) ?? []).map(String));
  if (baseProps || nextProps) {
    const bp = baseProps ?? {};
    const np = nextProps ?? {};
    for (const key of Object.keys(np)) {
      if (!(key in bp)) {
        const required = nextRequired.has(key);
        if (direction === 'request') {
          col.add(
            required ? 'breaking' : 'safe',
            scope,
            `New ${required ? 'required' : 'optional'} request field "${key}" on ${scope}`,
          );
        } else {
          col.add('safe', scope, `New response field "${key}" on ${scope}`);
        }
        continue;
      }
      // Present in both: check required toggles + recurse.
      const wasRequired = baseRequired.has(key);
      const isRequired = nextRequired.has(key);
      if (direction === 'request' && !wasRequired && isRequired) {
        col.add('breaking', scope, `Request field "${key}" became required on ${scope}`);
      }
      if (direction === 'request' && wasRequired && !isRequired) {
        col.add('risky', scope, `Request field "${key}" became optional on ${scope}`);
      }
      const childBase = obj(bp[key]);
      const childNext = obj(np[key]);
      if (childBase && childNext) {
        diffSchema(`${scope}.${key}`, childBase, childNext, col, direction);
      }
    }
    for (const key of Object.keys(bp)) {
      if (!(key in np)) {
        if (direction === 'response') {
          col.add(
            'breaking',
            scope,
            `Response field "${key}" removed from ${scope}`,
          );
        } else {
          const wasRequired = baseRequired.has(key);
          col.add(
            wasRequired ? 'breaking' : 'risky',
            scope,
            `Request field "${key}" removed from ${scope}`,
          );
        }
      }
    }
  }

  // Array items — recurse.
  const baseItems = obj(base.items);
  const nextItems = obj(next.items);
  if (baseItems && nextItems) {
    diffSchema(`${scope}[]`, baseItems, nextItems, col, direction);
  }

  // oneOf / anyOf / allOf — too deep to analyse carefully in v1.
  for (const combinator of ['oneOf', 'anyOf', 'allOf'] as const) {
    const baseArr = arr(base[combinator]);
    const nextArr = arr(next[combinator]);
    if ((baseArr || nextArr) && JSON.stringify(baseArr) !== JSON.stringify(nextArr)) {
      col.add('risky', scope, `${combinator} structure changed on ${scope}`);
    }
  }
}

export interface DiffClassification {
  readonly hasBreaking: boolean;
  readonly totalChanges: number;
}

export function classifyDiff(diff: DiffResult): DiffClassification {
  return {
    hasBreaking: diff.breaking.length > 0,
    totalChanges: diff.safe.length + diff.risky.length + diff.breaking.length,
  };
}
