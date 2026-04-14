/**
 * Fastify multipart body parser.
 *
 * Parses a `multipart/form-data` request into a plain object with
 * `TriadFile` instances for file fields and string values for text
 * fields. The resulting object is handed to Triad's normal body
 * validation pipeline, so file-size and mime-type constraints declared
 * via `t.file().maxSize(...).mimeTypes(...)` are enforced by the schema
 * layer.
 *
 * We use `@fastify/multipart` in "attachFieldsToBody: false" mode, i.e.
 * we drive the part iterator ourselves. This keeps the abstraction
 * identical to Triad's Express and Hono adapters: buffer the file into
 * memory, emit a `TriadFile`.
 */

import type { FastifyRequest } from 'fastify';
import type { TriadFile } from '@triadjs/core';

interface MultipartPart {
  type: 'file' | 'field';
  fieldname: string;
  filename?: string;
  mimetype?: string;
  value?: unknown;
  toBuffer?: () => Promise<Buffer>;
}

type PartsIterable = AsyncIterable<MultipartPart>;

export async function parseFastifyMultipart(
  request: FastifyRequest,
): Promise<Record<string, unknown>> {
  // `@fastify/multipart` attaches `parts()` to the request after the
  // plugin is registered. We type it here with a minimal structural
  // interface to avoid coupling to the plugin's TS types at build time.
  const req = request as unknown as { parts?: () => PartsIterable };
  if (typeof req.parts !== 'function') {
    throw new Error(
      '@triadjs/fastify: multipart body detected but `@fastify/multipart` is not registered. ' +
        'Install `@fastify/multipart` and ensure triadPlugin is mounted after registering it (the plugin auto-registers it when needed).',
    );
  }

  const result: Record<string, unknown> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file' && typeof part.toBuffer === 'function') {
      const buffer = await part.toBuffer();
      const file: TriadFile = {
        name: part.filename ?? part.fieldname,
        mimeType: part.mimetype ?? 'application/octet-stream',
        size: buffer.length,
        buffer,
        stream: () => bufferToStream(buffer),
      };
      assignField(result, part.fieldname, file);
    } else if (part.type === 'field') {
      assignField(result, part.fieldname, part.value);
    }
  }
  return result;
}

function assignField(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (name in target) {
    const existing = target[name];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      target[name] = [existing, value];
    }
    return;
  }
  target[name] = value;
}

function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}
