import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeCommand } from '../src/bin/route.ts';
import { loadConfig } from '../src/config.ts';
import { generateAuditCiConfig } from '../src/generate.ts';
import { buildUpdatedConfig, computeSyncDiff, serializeConfig } from '../src/sync.ts';
import type { AuditDepsConfig, AuditResult } from '../src/types.ts';

describe('integration: generate -> sync cycle', () => {
  let tempDir: string;
  let configDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `audit-deps-integration-${Date.now()}`);
    configDir = path.join(tempDir, '.config');
    outDir = path.join(tempDir, 'tmp');
    await mkdir(configDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates flat configs, then syncs allowlist based on audit results', async () => {
    // Step 1: Write initial config
    const initialConfig: AuditDepsConfig = {
      outDir: '../tmp',
      dev: { moderate: true, allowlist: [] },
      prod: {
        high: true,
        allowlist: [{ id: 'GHSA-stale', path: 'old-pkg', reason: 'will be removed', url: 'https://example.com/stale' }],
      },
    };
    const configFilePath = path.join(configDir, 'audit-deps.config.json');
    await writeFile(configFilePath, JSON.stringify(initialConfig, null, 2), 'utf8');

    // Step 2: Load and validate config
    const loaded = await loadConfig(configFilePath, tempDir);
    expect(loaded.config.prod.allowlist).toHaveLength(1);

    // Step 3: Generate flat audit-ci configs
    const devPath = await generateAuditCiConfig(loaded.config.dev, 'dev', configDir, loaded.config.outDir);
    const prodPath = await generateAuditCiConfig(loaded.config.prod, 'prod', configDir, loaded.config.outDir);

    expect(devPath).toBe(path.join(outDir, 'audit-ci.dev.json'));
    expect(prodPath).toBe(path.join(outDir, 'audit-ci.prod.json'));

    // Verify generated content
    const devContent: unknown = JSON.parse(await readFile(devPath, 'utf8'));
    expect(devContent).toHaveProperty('moderate', true);
    expect(devContent).toHaveProperty('allowlist', []);

    const prodContent: unknown = JSON.parse(await readFile(prodPath, 'utf8'));
    expect(prodContent).toHaveProperty('high', true);
    expect(prodContent).toHaveProperty('allowlist', ['GHSA-stale']);

    // Step 4: Simulate audit results (mocking audit-ci output)
    const prodAuditResults: AuditResult[] = [{ id: 'GHSA-new1', path: 'new-pkg', url: 'https://example.com/new1' }];

    // Step 5: Sync the prod allowlist
    const fixedDate = new Date('2025-06-15T00:00:00Z');
    const { added, kept, removed } = computeSyncDiff(loaded.config.prod.allowlist, prodAuditResults, fixedDate);

    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe('GHSA-new1');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.id).toBe('GHSA-stale');
    expect(kept).toHaveLength(0);

    // Step 6: Build and write updated config
    const updatedConfig = buildUpdatedConfig(loaded.config, 'prod', [...kept, ...added]);
    await writeFile(configFilePath, serializeConfig(updatedConfig), 'utf8');

    // Step 7: Verify persisted config
    const reloaded = await loadConfig(configFilePath, tempDir);
    expect(reloaded.config.prod.allowlist).toHaveLength(1);
    expect(reloaded.config.prod.allowlist[0]?.id).toBe('GHSA-new1');
    expect(reloaded.config.prod.allowlist[0]?.reason).toBe('Added by audit-deps sync on 2025-06-15');

    // Step 8: Regenerate and verify updated flat config
    const updatedProdPath = await generateAuditCiConfig(
      reloaded.config.prod,
      'prod',
      path.dirname(configFilePath),
      reloaded.config.outDir,
    );
    const updatedProdContent: unknown = JSON.parse(await readFile(updatedProdPath, 'utf8'));
    expect(updatedProdContent).toHaveProperty('allowlist', ['GHSA-new1']);
  });

  it('works with a custom config path', async () => {
    const customConfigPath = path.join(tempDir, 'custom', 'my-config.json');
    const customConfigDir = path.dirname(customConfigPath);
    await mkdir(customConfigDir, { recursive: true });

    const config: AuditDepsConfig = {
      outDir: './out',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(customConfigPath, JSON.stringify(config), 'utf8');

    const loaded = await loadConfig(customConfigPath, tempDir);
    expect(loaded.configFilePath).toBe(customConfigPath);
    expect(loaded.configDir).toBe(customConfigDir);

    const devPath = await generateAuditCiConfig(loaded.config.dev, 'dev', customConfigDir, loaded.config.outDir);
    expect(devPath).toBe(path.join(customConfigDir, 'out', 'audit-ci.dev.json'));

    const content: unknown = JSON.parse(await readFile(devPath, 'utf8'));
    expect(content).toHaveProperty('allowlist', []);
  });
});

describe('integration: --config flag via routeCommand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `audit-deps-config-flag-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates config files at the expected outDir when --config is passed', async () => {
    const customConfigPath = path.join(tempDir, 'my-audit-deps.json');
    const config: AuditDepsConfig = {
      outDir: './generated',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(customConfigPath, JSON.stringify(config, null, 2), 'utf8');

    await routeCommand(['generate', '--config', customConfigPath]);

    const expectedDevPath = path.join(tempDir, 'generated', 'audit-ci.dev.json');
    const expectedProdPath = path.join(tempDir, 'generated', 'audit-ci.prod.json');
    expect(existsSync(expectedDevPath)).toBe(true);
    expect(existsSync(expectedProdPath)).toBe(true);
  });
});
