import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFlatConfig, generateAuditCiConfig } from '../src/generate.ts';
import type { ScopeConfig } from '../src/types.ts';

describe(buildFlatConfig, () => {
  it('flattens allowlist entries to an array of IDs', () => {
    const scopeConfig: ScopeConfig = {
      allowlist: [
        { id: 'GHSA-1234', path: 'lodash', url: 'https://example.com/1' },
        { id: 'GHSA-5678', path: 'express', url: 'https://example.com/2' },
      ],
      moderate: true,
    };

    const flat = buildFlatConfig(scopeConfig);
    expect(flat.allowlist).toEqual(['GHSA-1234', 'GHSA-5678']);
    expect(flat.moderate).toBe(true);
    expect(flat['show-not-found']).toBe(true);
  });

  it('produces an empty allowlist when the source has no entries', () => {
    const scopeConfig: ScopeConfig = { allowlist: [], high: true };
    const flat = buildFlatConfig(scopeConfig);
    expect(flat.allowlist).toEqual([]);
    expect(flat.high).toBe(true);
  });

  it('omits severity fields that are not set', () => {
    const scopeConfig: ScopeConfig = { allowlist: [] };
    const flat = buildFlatConfig(scopeConfig);
    expect(flat).not.toHaveProperty('moderate');
    expect(flat).not.toHaveProperty('high');
    expect(flat).not.toHaveProperty('critical');
    expect(flat).not.toHaveProperty('low');
  });
});

describe(generateAuditCiConfig, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `audit-deps-generate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes the flat config file to the config directory by default', async () => {
    const scopeConfig: ScopeConfig = { allowlist: [], moderate: true };
    const outputPath = await generateAuditCiConfig(scopeConfig, 'dev', tempDir);

    expect(outputPath).toBe(path.join(tempDir, 'audit-ci.dev.json'));
    const content = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(content.allowlist).toEqual([]);
    expect(content.moderate).toBe(true);
  });

  it('resolves outDir relative to config directory', async () => {
    const scopeConfig: ScopeConfig = { allowlist: [], high: true };
    const outputPath = await generateAuditCiConfig(scopeConfig, 'prod', tempDir, '../tmp');

    const expected = path.resolve(tempDir, '../tmp', 'audit-ci.prod.json');
    expect(outputPath).toBe(expected);

    const content = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(content.high).toBe(true);
  });

  it('round-trips: load config values appear in generated JSON', async () => {
    const scopeConfig: ScopeConfig = {
      allowlist: [{ id: 'GHSA-abcd', path: 'pkg', url: 'https://example.com' }],
      critical: true,
    };
    const outputPath = await generateAuditCiConfig(scopeConfig, 'dev', tempDir);
    const content = JSON.parse(await readFile(outputPath, 'utf8'));

    expect(content.allowlist).toEqual(['GHSA-abcd']);
    expect(content.critical).toBe(true);
    expect(content['show-not-found']).toBe(true);
  });
});
