/**
 * `triad validate` — cross-artifact consistency checks.
 *
 * This is where Triad enforces invariants that individual packages can't
 * check on their own. The schema DSL validates data. The endpoint builder
 * validates types. This command validates the *relationships* between them:
 *
 *   1. No duplicate endpoint names across the router.
 *   2. No duplicate `METHOD path` combinations.
 *   3. Every `body_matches Model` assertion references a model that exists
 *      somewhere in the router. Without this, you can write a test that
 *      "passes" because the matcher found no model to check against.
 *   4. Endpoints inside a bounded context should only use models declared
 *      in that context's `models` list (when `models` is non-empty). This
 *      protects the ubiquitous language boundary.
 *   5. Every endpoint declares at least one response.
 *
 * The walkers use the `kind` string discriminator rather than `instanceof`
 * so this command works with routers loaded through duplicate module graphs
 * (e.g. a user router loaded by jiti while the CLI itself is loaded via
 * a bundler alias).
 *
 * Errors cause a non-zero exit; warnings are printed but do not fail unless
 * `--strict` is passed.
 */

import pc from 'picocolors';
import type { Endpoint, Router, SchemaNode, ModelShape, Channel } from '@triadjs/core';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';
import { analyzeCoverage, type CoverageReport } from './validate-coverage.js';

export interface ValidateOptions {
  config?: string;
  router?: string;
  strict?: boolean;
  coverage?: boolean;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  context?: string;
}

export async function runValidate(opts: ValidateOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });
  const issues = validateRouter(router);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  printIssues(issues);

  const shouldFail =
    errors.length > 0 || (opts.strict === true && warnings.length > 0);

  if (shouldFail) {
    throw new CliError(
      `Validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`,
      'VALIDATION_FAILED',
    );
  }

  if (issues.length === 0) {
    process.stdout.write(`${pc.green('✓')} All checks passed.\n`);
  } else {
    process.stdout.write(
      `${pc.green('✓')} No errors — ${warnings.length} warning(s).\n`,
    );
  }

  if (opts.coverage) {
    const report = analyzeCoverage(router);
    printCoverageReport(report);
  }
}

function printCoverageReport(report: CoverageReport): void {
  process.stdout.write(
    `\nCoverage analysis for ${report.totalEndpoints} endpoints...\n\n`,
  );

  for (const ep of report.endpoints) {
    if (ep.gaps.length === 0) {
      process.stdout.write(
        `${pc.green('✓')} ${ep.method} ${ep.path} — ${ep.name}\n` +
          `    All boundary paths covered (or no constraints to test)\n\n`,
      );
    } else {
      process.stdout.write(
        `${pc.yellow('⚠')} ${ep.method} ${ep.path} — ${ep.name}\n` +
          `    Missing coverage:\n`,
      );
      for (const gap of ep.gaps) {
        process.stdout.write(`    - ${gap}\n`);
      }
      process.stdout.write(
        `    Suggestion: add ...scenario.auto() to behaviors\n\n`,
      );
    }
  }

  process.stdout.write(
    `Coverage: ${report.fullyCovered}/${report.totalEndpoints} endpoints fully covered` +
      (report.totalEndpoints > report.fullyCovered
        ? `, ${report.totalEndpoints - report.fullyCovered} have gaps\n`
        : '\n'),
  );
}

// ---------------------------------------------------------------------------
// Validation logic (exported for unit tests)
// ---------------------------------------------------------------------------

export function validateRouter(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(...checkDuplicateEndpointNames(router));
  issues.push(...checkDuplicatePaths(router));
  issues.push(...checkEmptyResponses(router));

  const modelRegistry = collectAllModels(router);
  issues.push(...checkBodyMatchesReferences(router, modelRegistry));
  issues.push(...checkContextModelLeakage(router));

  issues.push(...checkDuplicateChannelNames(router));
  issues.push(...checkDuplicateChannelPaths(router));
  issues.push(...checkChannelHandlerCompleteness(router));
  issues.push(...checkChannelAssertionMessageTypes(router));
  issues.push(...checkChannelContextModelLeakage(router));

  return issues;
}

function checkDuplicateEndpointNames(router: Router): ValidationIssue[] {
  const seen = new Map<string, Endpoint>();
  const issues: ValidationIssue[] = [];
  for (const endpoint of router.allEndpoints()) {
    const prev = seen.get(endpoint.name);
    if (prev) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_ENDPOINT_NAME',
        message: `Two endpoints share the name "${endpoint.name}". Endpoint names must be unique (they become operationId in OpenAPI).`,
        context: `${endpoint.method} ${endpoint.path} vs ${prev.method} ${prev.path}`,
      });
    } else {
      seen.set(endpoint.name, endpoint);
    }
  }
  return issues;
}

function checkDuplicatePaths(router: Router): ValidationIssue[] {
  const seen = new Map<string, Endpoint>();
  const issues: ValidationIssue[] = [];
  for (const endpoint of router.allEndpoints()) {
    const key = `${endpoint.method} ${endpoint.path}`;
    const prev = seen.get(key);
    if (prev) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_PATH_METHOD',
        message: `Two endpoints share the same method and path: ${key}`,
        context: `${endpoint.name} vs ${prev.name}`,
      });
    } else {
      seen.set(key, endpoint);
    }
  }
  return issues;
}

function checkEmptyResponses(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const endpoint of router.allEndpoints()) {
    if (Object.keys(endpoint.responses).length === 0) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_RESPONSES',
        message: `Endpoint "${endpoint.name}" declares no responses. Every endpoint must declare at least one response.`,
        context: `${endpoint.method} ${endpoint.path}`,
      });
    }
  }
  return issues;
}

function checkBodyMatchesReferences(
  router: Router,
  registry: Map<string, SchemaNode>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const endpoint of router.allEndpoints()) {
    for (const behavior of endpoint.behaviors) {
      for (const assertion of behavior.then) {
        if (assertion.type === 'body_matches') {
          if (!registry.has(assertion.model)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_MODEL_REFERENCE',
              message: `Behavior asserts "response body matches ${assertion.model}" but no model with that name exists in the router. Make sure ${assertion.model} is used as a request or response schema somewhere.`,
              context: `${endpoint.name} / "${behavior.scenario}"`,
            });
          }
        }
      }
    }
  }
  return issues;
}

function checkContextModelLeakage(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const context of router.contexts) {
    if (context.models.length === 0) continue;

    const allowed = new Set<string>();
    for (const model of context.models) {
      collectNestedModelNames(model, allowed);
    }

    for (const endpoint of context.endpoints) {
      const used = new Set<string>();
      collectEndpointModelNames(endpoint, used);

      for (const modelName of used) {
        if (!allowed.has(modelName)) {
          issues.push({
            severity: 'warning',
            code: 'CONTEXT_MODEL_LEAKAGE',
            message: `Endpoint "${endpoint.name}" uses model "${modelName}" which is not declared in the "${context.name}" bounded context's models list. Either add it to the context or move the endpoint to a different context.`,
            context: `${endpoint.method} ${endpoint.path}`,
          });
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Channel-specific checks
// ---------------------------------------------------------------------------

function checkDuplicateChannelNames(router: Router): ValidationIssue[] {
  const seen = new Map<string, Channel>();
  const issues: ValidationIssue[] = [];
  for (const ch of router.allChannels()) {
    const prev = seen.get(ch.name);
    if (prev) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_CHANNEL_NAME',
        message: `Two channels share the name "${ch.name}". Channel names must be unique.`,
        context: `${ch.path} vs ${prev.path}`,
      });
    } else {
      seen.set(ch.name, ch);
    }
  }
  return issues;
}

function checkDuplicateChannelPaths(router: Router): ValidationIssue[] {
  const seen = new Map<string, Channel>();
  const issues: ValidationIssue[] = [];
  for (const ch of router.allChannels()) {
    const prev = seen.get(ch.path);
    if (prev) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_CHANNEL_PATH',
        message: `Two channels share the same path: ${ch.path}`,
        context: `${ch.name} vs ${prev.name}`,
      });
    } else {
      seen.set(ch.path, ch);
    }
  }
  return issues;
}

function checkChannelHandlerCompleteness(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const ch of router.allChannels()) {
    for (const messageType of Object.keys(ch.clientMessages)) {
      if (!(messageType in ch.handlers)) {
        issues.push({
          severity: 'warning',
          code: 'MISSING_CHANNEL_HANDLER',
          message: `Channel "${ch.name}" declares client message type "${messageType}" but has no matching handler.`,
          context: ch.path,
        });
      }
    }
  }
  return issues;
}

function checkChannelAssertionMessageTypes(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const ch of router.allChannels()) {
    const serverMsgTypes = new Set(Object.keys(ch.serverMessages));
    for (const behavior of ch.behaviors) {
      for (const assertion of behavior.then) {
        if (
          assertion.type === 'channel_receives' ||
          assertion.type === 'channel_not_receives' ||
          assertion.type === 'channel_message_has'
        ) {
          if (
            assertion.messageType !== '*' &&
            !serverMsgTypes.has(assertion.messageType)
          ) {
            issues.push({
              severity: 'warning',
              code: 'UNKNOWN_CHANNEL_MESSAGE_TYPE',
              message: `Behavior asserts on message type "${assertion.messageType}" but channel "${ch.name}" does not declare it in serverMessages. Check for typos.`,
              context: `${ch.name} / "${behavior.scenario}"`,
            });
          }
        }
      }
    }
  }
  return issues;
}

function checkChannelContextModelLeakage(router: Router): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const context of router.contexts) {
    if (context.models.length === 0) continue;

    const allowed = new Set<string>();
    for (const model of context.models) {
      collectNestedModelNames(model, allowed);
    }

    for (const ch of context.channels) {
      const used = new Set<string>();
      collectChannelModelNames(ch, used);

      for (const modelName of used) {
        if (!allowed.has(modelName)) {
          issues.push({
            severity: 'warning',
            code: 'CHANNEL_CONTEXT_MODEL_LEAKAGE',
            message: `Channel "${ch.name}" uses model "${modelName}" which is not declared in the "${context.name}" bounded context's models list. Either add it to the context or move the channel to a different context.`,
            context: ch.path,
          });
        }
      }
    }
  }

  return issues;
}

function collectChannelModelNames(ch: Channel, out: Set<string>): void {
  const walk = (schema: SchemaNode | undefined): void => {
    walkSchema(schema, (m) => {
      if (out.has(m.name)) return 'stop';
      out.add(m.name);
      return 'continue';
    });
  };
  for (const msg of Object.values(ch.clientMessages)) {
    walk(msg.schema);
  }
  for (const msg of Object.values(ch.serverMessages)) {
    walk(msg.schema);
  }
}

// ---------------------------------------------------------------------------
// Schema walkers — kind-based, portable across duplicate module graphs
// ---------------------------------------------------------------------------

interface ModelLike {
  readonly kind: 'model';
  readonly name: string;
  readonly shape: ModelShape;
}

function walkSchema(
  schema: SchemaNode | undefined,
  onModel: (m: ModelLike) => 'continue' | 'stop',
): void {
  if (!schema) return;
  switch (schema.kind) {
    case 'model': {
      const m = schema as unknown as ModelLike;
      if (onModel(m) === 'stop') return;
      for (const field of Object.values(m.shape)) {
        walkSchema(field as SchemaNode, onModel);
      }
      return;
    }
    case 'array': {
      walkSchema(
        (schema as unknown as { item: SchemaNode }).item,
        onModel,
      );
      return;
    }
    case 'record': {
      walkSchema(
        (schema as unknown as { valueSchema: SchemaNode }).valueSchema,
        onModel,
      );
      return;
    }
    case 'union': {
      for (const opt of (schema as unknown as { options: readonly SchemaNode[] })
        .options) {
        walkSchema(opt, onModel);
      }
      return;
    }
    case 'tuple': {
      for (const item of (schema as unknown as { items: readonly SchemaNode[] })
        .items) {
        walkSchema(item, onModel);
      }
      return;
    }
  }
}

function collectAllModels(router: Router): Map<string, SchemaNode> {
  const registry = new Map<string, SchemaNode>();
  const walk = (schema: SchemaNode | undefined): void => {
    walkSchema(schema, (m) => {
      if (registry.has(m.name)) return 'stop';
      registry.set(m.name, m as unknown as SchemaNode);
      return 'continue';
    });
  };
  for (const endpoint of router.allEndpoints()) {
    walk(endpoint.request.body);
    walk(endpoint.request.params);
    walk(endpoint.request.query);
    walk(endpoint.request.headers);
    for (const response of Object.values(endpoint.responses)) {
      walk(response.schema);
    }
  }
  return registry;
}

/**
 * Collect model names that count as "domain usage" for context leakage.
 *
 * Intentionally skips `request.params`, `request.query`, and
 * `request.headers`. Those are ephemeral URL/transport contracts — a
 * `{ id: t.string() }` params shape is not a domain model and should not
 * be policed by the bounded-context model list. The endpoint builder
 * wraps inline shapes in anonymous `ModelSchema`s named like
 * `{endpointName}Params` purely for OpenAPI emission, and dragging those
 * into the leakage check would produce noise on every endpoint.
 *
 * Bodies and responses, on the other hand, carry the domain types the
 * bounded context claims to own — those are the ones worth checking.
 */
function collectEndpointModelNames(endpoint: Endpoint, out: Set<string>): void {
  const walk = (schema: SchemaNode | undefined): void => {
    walkSchema(schema, (m) => {
      if (out.has(m.name)) return 'stop';
      out.add(m.name);
      return 'continue';
    });
  };
  walk(endpoint.request.body);
  for (const response of Object.values(endpoint.responses)) {
    walk(response.schema);
  }
}

function collectNestedModelNames(schema: SchemaNode, out: Set<string>): void {
  walkSchema(schema, (m) => {
    if (out.has(m.name)) return 'stop';
    out.add(m.name);
    return 'continue';
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length === 0) return;
  const lines: string[] = [''];
  for (const issue of issues) {
    const icon = issue.severity === 'error' ? pc.red('✗') : pc.yellow('!');
    const sev =
      issue.severity === 'error' ? pc.red('error') : pc.yellow('warning');
    lines.push(`${icon} ${sev} ${pc.dim(`[${issue.code}]`)}`);
    lines.push(`    ${issue.message}`);
    if (issue.context) {
      lines.push(`    ${pc.dim(issue.context)}`);
    }
    lines.push('');
  }
  process.stdout.write(lines.join('\n'));
}
