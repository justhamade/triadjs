import { describe, expect, it } from 'vitest';
import {
  t,
  FileSchema,
  isFileSchema,
  hasFileFields,
  type TriadFile,
} from '../../src/schema/index.js';
import { ValidationException } from '../../src/schema/types.js';

function makeFile(overrides: Partial<TriadFile> = {}): TriadFile {
  const buffer = overrides.buffer ?? Buffer.from('hello world');
  return {
    name: overrides.name ?? 'hello.txt',
    mimeType: overrides.mimeType ?? 'text/plain',
    size: overrides.size ?? buffer.length,
    buffer,
    stream: overrides.stream ?? (() => {
      throw new Error('stream() not available');
    }),
  };
}

describe('FileSchema', () => {
  it('parse accepts a valid TriadFile-shaped object', () => {
    const file = makeFile();
    const out = t.file().parse(file);
    expect(out).toBe(file);
  });

  it('parse rejects a non-object', () => {
    expect(() => t.file().parse('not a file')).toThrow(ValidationException);
    expect(() => t.file().parse(42)).toThrow(ValidationException);
  });

  it('parse rejects an object missing required properties', () => {
    expect(() => t.file().parse({ name: 'x.txt' })).toThrow(ValidationException);
  });

  it('parse rejects undefined when required', () => {
    expect(() => t.file().parse(undefined)).toThrow(ValidationException);
  });

  it('optional() allows undefined', () => {
    expect(t.file().optional().parse(undefined)).toBeUndefined();
  });

  it('maxSize enforces upper bound', () => {
    const file = makeFile({ size: 200, buffer: Buffer.alloc(200) });
    expect(() => t.file().maxSize(100).parse(file)).toThrow(ValidationException);
  });

  it('maxSize allows files at or below the bound', () => {
    const file = makeFile({ size: 50, buffer: Buffer.alloc(50) });
    expect(() => t.file().maxSize(100).parse(file)).not.toThrow();
  });

  it('maxSize surfaces a file_too_large error code', () => {
    const file = makeFile({ size: 200, buffer: Buffer.alloc(200) });
    const result = t.file().maxSize(100).validate(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('file_too_large');
    }
  });

  it('minSize enforces lower bound', () => {
    const file = makeFile({ size: 5, buffer: Buffer.alloc(5) });
    expect(() => t.file().minSize(10).parse(file)).toThrow(ValidationException);
  });

  it('mimeTypes enforces an allowlist', () => {
    const file = makeFile({ mimeType: 'image/jpeg' });
    expect(() => t.file().mimeTypes('image/png').parse(file)).toThrow(
      ValidationException,
    );
  });

  it('mimeTypes surfaces an invalid_mime_type error code', () => {
    const file = makeFile({ mimeType: 'image/jpeg' });
    const result = t.file().mimeTypes('image/png').validate(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('invalid_mime_type');
    }
  });

  it('mimeTypes accepts files whose mime is in the allowlist', () => {
    const file = makeFile({ mimeType: 'image/png' });
    expect(() =>
      t.file().mimeTypes('image/png', 'image/jpeg').parse(file),
    ).not.toThrow();
  });

  it('toOpenAPI emits a string/binary shape with the internal __file marker', () => {
    const out = t.file().toOpenAPI() as unknown as Record<string, unknown>;
    expect(out['type']).toBe('string');
    expect(out['format']).toBe('binary');
    expect(out['__file']).toBe(true);
  });

  it('isFileSchema returns true for file schemas', () => {
    expect(isFileSchema(t.file())).toBe(true);
  });

  it('isFileSchema returns false for other schemas and values', () => {
    expect(isFileSchema(t.string())).toBe(false);
    expect(isFileSchema(t.model('M', { n: t.string() }))).toBe(false);
    expect(isFileSchema(undefined)).toBe(false);
    expect(isFileSchema(null)).toBe(false);
    expect(isFileSchema({})).toBe(false);
  });

  it('instances satisfy the FileSchema class check', () => {
    expect(t.file()).toBeInstanceOf(FileSchema);
  });
});

describe('hasFileFields', () => {
  it('returns true for a model with a direct file field', () => {
    expect(
      hasFileFields(t.model('Upload', { file: t.file(), name: t.string() })),
    ).toBe(true);
  });

  it('returns false for a model with no file fields', () => {
    expect(
      hasFileFields(t.model('NoFile', { name: t.string(), age: t.int32() })),
    ).toBe(false);
  });

  it('returns true when a file is nested inside another model', () => {
    const Inner = t.model('Inner', { avatar: t.file() });
    const Outer = t.model('Outer', { inner: Inner, name: t.string() });
    expect(hasFileFields(Outer)).toBe(true);
  });

  it('returns true when a file is inside an array', () => {
    const Upload = t.model('Upload', {
      files: t.array(t.file()),
    });
    expect(hasFileFields(Upload)).toBe(true);
  });

  it('returns true for a bare FileSchema', () => {
    expect(hasFileFields(t.file())).toBe(true);
  });

  it('returns false for primitive schemas', () => {
    expect(hasFileFields(t.string())).toBe(false);
    expect(hasFileFields(t.int32())).toBe(false);
  });

  it('returns true when a file is optional', () => {
    expect(
      hasFileFields(t.model('M', { avatar: t.file().optional() })),
    ).toBe(true);
  });
});
