import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.ts';
import { DEFAULT_CONFIG } from '../src/types.ts';

describe(loadConfig, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `audit-deps-config-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads and validates a well-formed config', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });

    const config = {
      dev: { severityThreshold: 'high', allowlist: [] },
      prod: {
        severityThreshold: 'moderate',
        allowlist: [{ id: 'GHSA-1234', path: 'lodash', url: 'https://example.com' }],
      },
    };
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify(config), 'utf8');

    const result = await loadConfig(undefined, tempDir);
    expect(result.config.dev.severityThreshold).toBe('high');
    expect(result.config.prod.allowlist).toHaveLength(1);
    expect(result.configDir).toBe(configDir);
    expect(result.configSource).toBe('file');
  });

  it('returns defaults when no config file exists and no explicit path is given', async () => {
    const result = await loadConfig(undefined, tempDir);
    expect(result.config).toStrictEqual(DEFAULT_CONFIG);
    expect(result.configSource).toBe('defaults');
    expect(result.configFilePath).toBe(path.resolve(tempDir, '.config/audit-deps.config.json'));
  });

  it('throws when an explicit config path does not exist', async () => {
    await expect(loadConfig('nonexistent.json', tempDir)).rejects.toThrow(/Config file not found/);
  });

  it('throws when the config file is not valid JSON', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'audit-deps.config.json'), 'not json', 'utf8');

    await expect(loadConfig(undefined, tempDir)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the config fails schema validation', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify({ bad: true }), 'utf8');

    await expect(loadConfig(undefined, tempDir)).rejects.toThrow(/Invalid config/);
  });

  it('rejects configs with old boolean severity fields', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });
    const config = {
      dev: { moderate: true, allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify(config), 'utf8');

    await expect(loadConfig(undefined, tempDir)).rejects.toThrow(/Invalid config/);
  });

  it('rejects configs with outDir', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });
    const config = {
      outDir: '../tmp',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify(config), 'utf8');

    await expect(loadConfig(undefined, tempDir)).rejects.toThrow(/Invalid config/);
  });

  it('accepts a custom config path', async () => {
    const config = {
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    const customPath = path.join(tempDir, 'custom.json');
    await writeFile(customPath, JSON.stringify(config), 'utf8');

    const result = await loadConfig(customPath, tempDir);
    expect(result.config.dev.allowlist).toStrictEqual([]);
    expect(result.configFilePath).toBe(customPath);
    expect(result.configSource).toBe('file');
  });

  it('loads a config with empty allowlists', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });

    const config = {
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify(config), 'utf8');

    const result = await loadConfig(undefined, tempDir);
    expect(result.config.dev.allowlist).toStrictEqual([]);
    expect(result.config.prod.allowlist).toStrictEqual([]);
  });

  it('accepts a config with $schema field', async () => {
    const configDir = path.join(tempDir, '.config');
    await mkdir(configDir, { recursive: true });
    const config = {
      $schema: 'https://example.com/schema.json',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(path.join(configDir, 'audit-deps.config.json'), JSON.stringify(config), 'utf8');

    const result = await loadConfig(undefined, tempDir);
    expect(result.config.$schema).toBe('https://example.com/schema.json');
  });
});
