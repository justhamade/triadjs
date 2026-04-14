/**
 * Tiny Express-style path matcher.
 *
 * `@triadjs/lambda` is not mounted inside an Express or Hono router, so it
 * has to do its own path matching against the list of endpoints. We
 * compile each endpoint's path pattern (e.g. `/pets/:id/toys/:toyId`)
 * once at router-build time into a regex + ordered list of param keys.
 *
 * The compiler is deliberately minimal — it supports colon params
 * (`:name`) only. No wildcards, no optional segments, no regex
 * constraints. That matches what Triad endpoint paths actually use.
 */

export interface CompiledPattern {
  readonly regex: RegExp;
  readonly keys: readonly string[];
}

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

export function compilePattern(pattern: string): CompiledPattern {
  const keys: string[] = [];
  const escaped = pattern
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(PARAM, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
  return {
    regex: new RegExp(`^${escaped}$`),
    keys,
  };
}

export interface MatchResult {
  readonly params: Record<string, string>;
}

export function matchPattern(
  compiled: CompiledPattern,
  path: string,
): MatchResult | undefined {
  const m = compiled.regex.exec(path);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < compiled.keys.length; i++) {
    const key = compiled.keys[i];
    const value = m[i + 1];
    if (key !== undefined && value !== undefined) {
      params[key] = decodeURIComponent(value);
    }
  }
  return { params };
}
