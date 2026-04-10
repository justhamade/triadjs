/**
 * Router → Gherkin `.feature` files.
 *
 * Grouping strategy (in order of precedence):
 *
 *   1. If an endpoint is registered inside a bounded context, it goes under
 *      a feature named after that context. The context description becomes
 *      the `Feature:` description paragraph.
 *   2. Otherwise, the endpoint's first declared tag becomes the feature
 *      name.
 *   3. Endpoints with neither a context nor tags go into an `Other` feature.
 *
 * Endpoints with no behaviors are skipped — there is nothing to write.
 * Features that end up with zero scenarios are not emitted.
 */

import type { Router, Endpoint, Behavior } from '@triad/core';
import { formatScenario } from './formatter.js';

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface FeatureFile {
  /** Human-readable feature name (used in `Feature:` and filenames). */
  name: string;
  /** Kebab-cased filename ending in `.feature`. */
  filename: string;
  /** Complete Gherkin document text, ending in a trailing newline. */
  content: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk a router and produce one `FeatureFile` per feature group.
 * Returned in stable order: bounded contexts in declaration order first,
 * then tag-based features alphabetically, then `Other` if present.
 */
export function generateGherkin(router: Router): FeatureFile[] {
  const contextFeatures = new Map<string, FeatureBuilder>();
  const tagFeatures = new Map<string, FeatureBuilder>();
  let otherFeature: FeatureBuilder | undefined;

  // Seed context features in router-declaration order so the output ordering
  // is deterministic and matches the user's mental model.
  for (const ctx of router.contexts) {
    contextFeatures.set(
      ctx.name,
      new FeatureBuilder(ctx.name, ctx.description),
    );
  }

  for (const endpoint of router.allEndpoints()) {
    if (endpoint.behaviors.length === 0) continue;

    const context = router.contextOf(endpoint);
    if (context) {
      const feature = contextFeatures.get(context.name)!;
      feature.add(endpoint);
      continue;
    }

    const firstTag = endpoint.tags[0];
    if (firstTag !== undefined) {
      if (!tagFeatures.has(firstTag)) {
        tagFeatures.set(firstTag, new FeatureBuilder(firstTag));
      }
      tagFeatures.get(firstTag)!.add(endpoint);
      continue;
    }

    otherFeature ??= new FeatureBuilder('Other');
    otherFeature.add(endpoint);
  }

  const files: FeatureFile[] = [];

  for (const feature of contextFeatures.values()) {
    if (feature.hasScenarios()) files.push(feature.build());
  }

  // Tag features sorted alphabetically for stable output.
  const tagFeaturesSorted = [...tagFeatures.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, f]) => f);
  for (const feature of tagFeaturesSorted) {
    if (feature.hasScenarios()) files.push(feature.build());
  }

  if (otherFeature && otherFeature.hasScenarios()) {
    files.push(otherFeature.build());
  }

  return files;
}

// ---------------------------------------------------------------------------
// FeatureBuilder — accumulates endpoints and renders the final file.
// ---------------------------------------------------------------------------

class FeatureBuilder {
  private readonly scenarios: Behavior[] = [];

  constructor(
    readonly name: string,
    readonly description?: string,
  ) {}

  add(endpoint: Endpoint): void {
    for (const behavior of endpoint.behaviors) {
      this.scenarios.push(behavior);
    }
  }

  hasScenarios(): boolean {
    return this.scenarios.length > 0;
  }

  build(): FeatureFile {
    const lines: string[] = [];
    lines.push(`Feature: ${this.name}`);

    if (this.description !== undefined && this.description.trim() !== '') {
      lines.push('');
      // Gherkin free-text description: indent lines by two spaces.
      for (const line of this.description.split('\n')) {
        lines.push(`  ${line}`);
      }
    }

    for (const behavior of this.scenarios) {
      lines.push('');
      lines.push(...formatScenario(behavior));
    }

    const content = lines.join('\n') + '\n';
    return {
      name: this.name,
      filename: `${toKebabCase(this.name)}.feature`,
      content,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a feature name to a lowercase, hyphen-separated filename. */
export function toKebabCase(s: string): string {
  return s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}
