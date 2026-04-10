/**
 * `triad docs` — generate API documentation from the project router.
 *
 * Always emits an OpenAPI 3.1 document from HTTP endpoints. If the router
 * also declares WebSocket channels, an AsyncAPI 3.0 document is emitted
 * alongside it (at the sibling path `asyncapi.{yaml|json}`), so one
 * command covers both protocols.
 *
 * CLI flags override `triad.config.ts` settings. Output format is inferred
 * from the file extension if not explicitly set (`*.json` → JSON, anything
 * else → YAML).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import pc from 'picocolors';
import { generateOpenAPI, toJson, toYaml } from '@triad/openapi';
import {
  generateAsyncAPI,
  toYaml as toAsyncYaml,
  toJson as toAsyncJson,
} from '@triad/asyncapi';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';

export interface DocsOptions {
  config?: string;
  router?: string;
  output?: string;
  format?: 'yaml' | 'json';
}

const DEFAULT_OUTPUT = './generated/openapi.yaml';

export async function runDocs(opts: DocsOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const outputRelative =
    opts.output ?? loaded.config.docs?.output ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(loaded.configDir, outputRelative);
  const format =
    opts.format ?? loaded.config.docs?.format ?? inferFormat(outputPath);

  // --- OpenAPI ----------------------------------------------------------
  const openapi = generateOpenAPI(router);
  const openapiContent = format === 'json' ? toJson(openapi) : toYaml(openapi);

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, openapiContent, 'utf8');
  } catch (err) {
    throw new CliError(
      `Failed to write ${outputPath}: ${err instanceof Error ? err.message : String(err)}`,
      'OUTPUT_WRITE_FAILED',
    );
  }

  const schemaCount = Object.keys(openapi.components.schemas).length;
  const pathCount = Object.keys(openapi.paths).length;
  process.stdout.write(
    `${pc.green('✓')} OpenAPI ${format.toUpperCase()} written to ${pc.bold(outputPath)}\n` +
      `  ${pc.dim(`${pathCount} path(s), ${schemaCount} component schema(s)`)}\n`,
  );

  // --- AsyncAPI (only when the router has channels) --------------------
  const channels = router.allChannels();
  if (channels.length === 0) return;

  const asyncapiPath = deriveAsyncAPIPath(outputPath, format);
  const asyncapi = generateAsyncAPI(router);
  const asyncapiContent =
    format === 'json' ? toAsyncJson(asyncapi) : toAsyncYaml(asyncapi);

  try {
    fs.writeFileSync(asyncapiPath, asyncapiContent, 'utf8');
  } catch (err) {
    throw new CliError(
      `Failed to write ${asyncapiPath}: ${err instanceof Error ? err.message : String(err)}`,
      'OUTPUT_WRITE_FAILED',
    );
  }

  const channelCount = Object.keys(asyncapi.channels).length;
  const operationCount = Object.keys(asyncapi.operations).length;
  process.stdout.write(
    `${pc.green('✓')} AsyncAPI ${format.toUpperCase()} written to ${pc.bold(asyncapiPath)}\n` +
      `  ${pc.dim(`${channelCount} channel(s), ${operationCount} operation(s)`)}\n`,
  );
}

/** Produce the sibling AsyncAPI path next to the OpenAPI output. */
function deriveAsyncAPIPath(
  openapiPath: string,
  format: 'yaml' | 'json',
): string {
  const dir = path.dirname(openapiPath);
  const ext = format === 'json' ? '.json' : '.yaml';
  return path.join(dir, `asyncapi${ext}`);
}

function inferFormat(filePath: string): 'yaml' | 'json' {
  return filePath.toLowerCase().endsWith('.json') ? 'json' : 'yaml';
}
