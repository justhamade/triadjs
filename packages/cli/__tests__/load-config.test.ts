import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../src/load-config.js';
import { CliError } from '../src/errors.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'triad-cli-'));
}

describe('loadConfig', () => {
  it('loads a TypeScript config file via jiti', async () => {
    const dir = tempDir();
    try {
      const configPath = path.join(dir, 'triad.config.ts');
      fs.writeFileSync(
        configPath,
        `export default { router: './src/app.ts', test: { bail: true } };\n`,
      );
      const loaded = await loadConfig(configPath);
      expect(loaded.config.router).toBe('./src/app.ts');
      expect(loaded.config.test?.bail).toBe(true);
      expect(loaded.configPath).toBe(configPath);
      expect(loaded.configDir).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('walks up from cwd to find triad.config.ts', async () => {
    const parent = tempDir();
    try {
      const configPath = path.join(parent, 'triad.config.ts');
      fs.writeFileSync(
        configPath,
        `export default { router: './src/app.ts' };\n`,
      );
      const nested = path.join(parent, 'deeply', 'nested', 'dir');
      fs.mkdirSync(nested, { recursive: true });
      const loaded = await loadConfig(undefined, nested);
      expect(loaded.configPath).toBe(configPath);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('throws CliError CONFIG_NOT_FOUND when no config exists', async () => {
    const dir = tempDir();
    try {
      await expect(loadConfig(undefined, dir)).rejects.toMatchObject({
        name: 'CliError',
        code: 'CONFIG_NOT_FOUND',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws CliError CONFIG_NOT_FOUND when explicit path does not exist', async () => {
    await expect(
      loadConfig('/nonexistent/path/triad.config.ts'),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('throws CliError CONFIG_INVALID when config file is broken', async () => {
    const dir = tempDir();
    try {
      const configPath = path.join(dir, 'triad.config.ts');
      fs.writeFileSync(configPath, 'this is not valid typescript @@@');
      await expect(loadConfig(configPath)).rejects.toMatchObject({
        name: 'CliError',
        code: 'CONFIG_INVALID',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
