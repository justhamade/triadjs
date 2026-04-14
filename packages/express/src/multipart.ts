/**
 * Express multipart body parser.
 *
 * Triad delegates multipart parsing to `multer` (memoryStorage), then
 * normalizes the resulting `req.files` array into `TriadFile` instances
 * merged with the text fields from `req.body`. The result is the plain
 * object shape the endpoint's body schema expects, which is fed
 * through Triad's regular validation pipeline.
 */

import type { Request, RequestHandler } from 'express';
import type { TriadFile } from '@triadjs/core';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface MulterModule {
  (options: unknown): {
    any(): RequestHandler;
  };
  memoryStorage(): unknown;
}

let multerRef: MulterModule | undefined;

async function loadMulter(): Promise<MulterModule> {
  if (multerRef) return multerRef;
  try {
    const imported = (await import('multer')) as
      | MulterModule
      | { default: MulterModule };
    multerRef =
      typeof imported === 'function'
        ? imported
        : (imported as { default: MulterModule }).default;
    return multerRef;
  } catch (err) {
    throw new Error(
      '@triadjs/express: the router contains endpoints with t.file() fields but `multer` is not installed. ' +
        'Run `npm install multer` to enable file upload support.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { cause: err as any },
    );
  }
}

/**
 * Build a multer middleware that buffers all files into memory. Caps
 * at 100MB per file / 10 files per request as a last-resort safeguard;
 * `t.file().maxSize(...)` is the correct place to enforce app limits.
 *
 * Returned as an async-initialized middleware: the first call resolves
 * multer lazily, subsequent calls reuse the same handler.
 */
export function createMultipartMiddleware(): RequestHandler {
  let inner: RequestHandler | undefined;
  let initPromise: Promise<RequestHandler> | undefined;
  return (req, res, next) => {
    if (inner) {
      inner(req, res, next);
      return;
    }
    if (!initPromise) {
      initPromise = loadMulter().then((multer) => {
        const storage = multer.memoryStorage();
        const handler = multer({
          storage,
          limits: { fileSize: 100 * 1024 * 1024, files: 10 },
        }).any();
        inner = handler;
        return handler;
      });
    }
    initPromise
      .then((handler) => handler(req, res, next))
      .catch((err: unknown) => next(err));
  };
}

/**
 * Given an Express request post-multer, build the plain object that
 * the endpoint's body schema will validate. Text fields come from
 * `req.body`; files come from `req.files` (a flat array produced by
 * `multer.any()`).
 */
export function buildTriadBodyFromExpress(
  req: Request,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(req.body as Record<string, unknown>) };
  const files = (req as Request & { files?: MulterFile[] }).files;
  if (!files) return out;
  for (const f of files) {
    const triadFile: TriadFile = {
      name: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      buffer: f.buffer,
      stream: () => bufferToStream(f.buffer),
    };
    if (f.fieldname in out) {
      const existing = out[f.fieldname];
      if (Array.isArray(existing)) existing.push(triadFile);
      else out[f.fieldname] = [existing, triadFile];
    } else {
      out[f.fieldname] = triadFile;
    }
  }
  return out;
}

function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}
