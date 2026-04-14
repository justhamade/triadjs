/**
 * Router → Gherkin `.feature` files.
 *
 * Grouping strategy (in order of precedence) — identical for HTTP
 * endpoints and WebSocket channels:
 *
 *   1. If the route is registered inside a bounded context, it goes
 *      under a feature named after that context. The context
 *      description becomes the `Feature:` description paragraph.
 *   2. Otherwise, the route's first declared tag becomes the feature
 *      name.
 *   3. Routes with neither a context nor tags go into an `Other`
 *      feature.
 *
 * Within a feature, HTTP endpoint scenarios are emitted before channel
 * scenarios, each in router-declaration order. Routes with no
 * behaviors are skipped — there is nothing to write. Features that
 * end up with zero scenarios are not emitted.
 */

import type { Router, Endpoint, Channel, Behavior } from '@triadjs/core';
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

  const placeEndpoint = (endpoint: Endpoint): void => {
    if (endpoint.behaviors.length === 0) return;

    const context = router.contextOf(endpoint);
    if (context) {
      contextFeatures.get(context.name)!.addEndpoint(endpoint);
      return;
    }

    const firstTag = endpoint.tags[0];
    if (firstTag !== undefined) {
      if (!tagFeatures.has(firstTag)) {
        tagFeatures.set(firstTag, new FeatureBuilder(firstTag));
      }
      tagFeatures.get(firstTag)!.addEndpoint(endpoint);
      return;
    }

    otherFeature ??= new FeatureBuilder('Other');
    otherFeature.addEndpoint(endpoint);
  };

  const placeChannel = (channel: Channel): void => {
    if (channel.behaviors.length === 0) return;

    const context = router.contextOf(channel);
    if (context) {
      contextFeatures.get(context.name)!.addChannel(channel);
      return;
    }

    const firstTag = channel.tags[0];
    if (firstTag !== undefined) {
      if (!tagFeatures.has(firstTag)) {
        tagFeatures.set(firstTag, new FeatureBuilder(firstTag));
      }
      tagFeatures.get(firstTag)!.addChannel(channel);
      return;
    }

    otherFeature ??= new FeatureBuilder('Other');
    otherFeature.addChannel(channel);
  };

  // HTTP endpoints first so that within any feature they render before
  // channel scenarios — stable, documented ordering.
  for (const endpoint of router.allEndpoints()) {
    placeEndpoint(endpoint);
  }
  for (const channel of router.allChannels()) {
    placeChannel(channel);
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
  // HTTP endpoint behaviors and channel behaviors are tracked
  // separately so we can emit all endpoint scenarios before any
  // channel scenarios when building the final file.
  private readonly endpointScenarios: Behavior[] = [];
  private readonly channelScenarios: Behavior[] = [];

  constructor(
    readonly name: string,
    readonly description?: string,
  ) {}

  addEndpoint(endpoint: Endpoint): void {
    for (const behavior of endpoint.behaviors) {
      this.endpointScenarios.push(behavior);
    }
  }

  addChannel(channel: Channel): void {
    for (const behavior of channel.behaviors) {
      this.channelScenarios.push(behavior);
    }
  }

  hasScenarios(): boolean {
    return (
      this.endpointScenarios.length > 0 || this.channelScenarios.length > 0
    );
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

    for (const behavior of this.endpointScenarios) {
      lines.push('');
      lines.push(...formatScenario(behavior));
    }
    for (const behavior of this.channelScenarios) {
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
