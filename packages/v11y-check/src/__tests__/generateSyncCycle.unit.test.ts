import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { loadConfig } from '../config.ts';
import { generateAuditCiConfig } from '../generate.ts';
import { buildUpdatedConfig, computeSyncDiff, serializeConfig } from '../sync.ts';
import type { AuditResult, V11yCheckConfig } from '../types.ts';

const it = baseIt
  .extend(
    'tree',
    makeFixture(() => createTempTree({ '.config/': '' }, { prefix: 'v11y-check-integration-' })),
  )
  .extend('configDir', ({ tree }) => path.join(tree.dir, '.config'));

describe('generate -> sync cycle', () => {
  it('generates flat configs, then syncs allowlist based on audit results', async ({ configDir, tree }) => {
    // Write initial config with new schema
    const initialConfig: V11yCheckConfig = {
      dev: { severityThreshold: 'high', allowlist: [] },
      prod: {
        severityThreshold: 'moderate',
        allowlist: [{ id: 'GHSA-stale', path: 'old-pkg', reason: 'will be removed', url: 'https://example.com/stale' }],
      },
    };
    const configFilePath = path.join(configDir, 'v11y-check.config.json');
    await writeFile(configFilePath, JSON.stringify(initialConfig, null, 2), 'utf8');

    // Load and validate config
    const loaded = await loadConfig(configFilePath, tree.dir);
    expect(loaded.config.prod.allowlist).toHaveLength(1);

    // Generate flat audit-ci configs to a temp output dir
    const outputDir = path.join(tree.dir, 'tmp');
    await mkdir(outputDir, { recursive: true });
    const devPath = await generateAuditCiConfig(loaded.config.dev, 'dev', outputDir);
    const prodPath = await generateAuditCiConfig(loaded.config.prod, 'prod', outputDir);

    expect(devPath).toBe(path.join(outputDir, 'audit-ci.dev.json'));
    expect(prodPath).toBe(path.join(outputDir, 'audit-ci.prod.json'));

    // Verify generated content uses severity threshold translation
    const devContent: unknown = JSON.parse(await readFile(devPath, 'utf8'));
    expect(devContent).toHaveProperty('high', true);
    expect(devContent).toHaveProperty('allowlist', []);

    const prodContent: unknown = JSON.parse(await readFile(prodPath, 'utf8'));
    expect(prodContent).toHaveProperty('moderate', true);
    expect(prodContent).toHaveProperty('allowlist', ['GHSA-stale']);

    // Simulate audit results
    const prodAuditResults: AuditResult[] = [
      { id: 'GHSA-new1', path: 'new-pkg', paths: ['new-pkg'], url: 'https://example.com/new1' },
    ];

    // Sync the prod allowlist
    const fixedDate = new Date('2025-06-15T00:00:00Z');
    const { added, kept, removed } = computeSyncDiff(loaded.config.prod.allowlist, prodAuditResults, fixedDate);

    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe('GHSA-new1');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.id).toBe('GHSA-stale');
    expect(kept).toHaveLength(0);

    // Build and write updated config
    const updatedConfig = buildUpdatedConfig(loaded.config, 'prod', [...kept, ...added]);
    await writeFile(configFilePath, serializeConfig(updatedConfig), 'utf8');

    // Verify persisted config
    const reloaded = await loadConfig(configFilePath, tree.dir);
    expect(reloaded.config.prod.allowlist).toHaveLength(1);
    expect(reloaded.config.prod.allowlist[0]?.id).toBe('GHSA-new1');
    expect(reloaded.config.prod.allowlist[0]?.reason).toBe('Added by v11y sync at 2025-06-15 00:00:00 UTC');

    // Regenerate and verify updated flat config
    const updatedProdPath = await generateAuditCiConfig(reloaded.config.prod, 'prod', outputDir);
    const updatedProdContent: unknown = JSON.parse(await readFile(updatedProdPath, 'utf8'));
    expect(updatedProdContent).toHaveProperty('allowlist', ['GHSA-new1']);
  });

  it('works with a custom config path', async ({ tree }) => {
    const customConfigPath = path.join(tree.dir, 'custom', 'my-config.json');
    const customConfigDir = path.dirname(customConfigPath);
    await mkdir(customConfigDir, { recursive: true });

    const config: V11yCheckConfig = {
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    await writeFile(customConfigPath, JSON.stringify(config), 'utf8');

    const loaded = await loadConfig(customConfigPath, tree.dir);
    expect(loaded.configFilePath).toBe(customConfigPath);
    expect(loaded.configDir).toBe(customConfigDir);

    const devPath = await generateAuditCiConfig(loaded.config.dev, 'dev', customConfigDir);
    expect(devPath).toBe(path.join(customConfigDir, 'audit-ci.dev.json'));

    const content: unknown = JSON.parse(await readFile(devPath, 'utf8'));
    expect(content).toHaveProperty('allowlist', []);
  });

  it('returns defaults when no config file exists', async ({ tree }) => {
    const emptyDir = path.join(tree.dir, 'empty-project');
    await mkdir(emptyDir, { recursive: true });

    const result = await loadConfig(undefined, emptyDir);
    expect(result.configSource).toBe('defaults');
    expect(result.config.dev.severityThreshold).toBe('moderate');
    expect(result.config.prod.severityThreshold).toBe('low');
  });
});
