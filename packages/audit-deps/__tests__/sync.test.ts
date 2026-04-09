import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildUpdatedConfig, computeSyncDiff, serializeConfig, syncAllowlist } from '../src/sync.ts';
import type { AllowlistEntry, AuditDepsConfig, AuditResult } from '../src/types.ts';

const fixedDate = new Date('2025-06-15T00:00:00Z');

describe(computeSyncDiff, () => {
  it('adds new advisories not in the current allowlist', () => {
    const current: AllowlistEntry[] = [];
    const audit: AuditResult[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];

    const { added, kept, removed } = computeSyncDiff(current, audit, fixedDate);

    expect(added).toHaveLength(1);
    expect(added[0]?.reason).toBe('Added by audit-deps sync on 2025-06-15');
    expect(kept).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('removes advisories no longer in audit output', () => {
    const current: AllowlistEntry[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];
    const audit: AuditResult[] = [];

    const { added, kept, removed } = computeSyncDiff(current, audit, fixedDate);

    expect(added).toHaveLength(0);
    expect(kept).toHaveLength(0);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.id).toBe('1001');
  });

  it('preserves existing entries with manual reasons', () => {
    const current: AllowlistEntry[] = [
      { id: '1001', path: 'lodash', reason: 'accepted risk', url: 'https://example.com/1001' },
    ];
    const audit: AuditResult[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];

    const { added, kept, removed } = computeSyncDiff(current, audit, fixedDate);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.reason).toBe('accepted risk');
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('keeps entry without reason when ID is still in audit output', () => {
    const current: AllowlistEntry[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];
    const audit: AuditResult[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];

    const { kept } = computeSyncDiff(current, audit, fixedDate);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.reason).toBeUndefined();
  });

  it('computes a mixed diff with additions and removals', () => {
    const current: AllowlistEntry[] = [
      { id: '1001', path: 'lodash', url: 'https://example.com/1001' },
      { id: '1002', path: 'express', reason: 'manual reason', url: 'https://example.com/1002' },
    ];
    const audit: AuditResult[] = [
      { id: '1002', path: 'express', url: 'https://example.com/1002' },
      { id: '1003', path: 'axios', url: 'https://example.com/1003' },
    ];

    const { added, kept, removed } = computeSyncDiff(current, audit, fixedDate);

    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe('1003');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe('1002');
    expect(kept[0]?.reason).toBe('manual reason');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.id).toBe('1001');
  });

  it('returns empty arrays when both lists are empty', () => {
    const { added, kept, removed } = computeSyncDiff([], [], fixedDate);
    expect(added).toEqual([]);
    expect(kept).toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe(buildUpdatedConfig, () => {
  it('replaces the allowlist for the given scope, sorted by ID', () => {
    const config: AuditDepsConfig = {
      dev: { allowlist: [], moderate: true },
      prod: { allowlist: [], high: true },
    };

    const entries: AllowlistEntry[] = [
      { id: 'z-entry', path: 'z', url: 'https://z' },
      { id: 'a-entry', path: 'a', url: 'https://a' },
    ];

    const updated = buildUpdatedConfig(config, 'dev', entries);
    expect(updated.dev.allowlist[0]?.id).toBe('a-entry');
    expect(updated.dev.allowlist[1]?.id).toBe('z-entry');
    expect(updated.prod.allowlist).toEqual([]);
  });
});

describe(serializeConfig, () => {
  it('produces JSON with alphabetically ordered allowlist entry keys', () => {
    const config: AuditDepsConfig = {
      dev: {
        allowlist: [{ id: '1001', path: 'lodash', reason: 'test', url: 'https://example.com' }],
      },
      prod: { allowlist: [] },
    };

    const json = serializeConfig(config);
    // Re-parse through the typed loader to verify key order in raw JSON
    const devMatch = json.match(/"allowlist":\s*\[\s*\{([^}]+)\}/);
    const keyOrder = devMatch?.[1]?.match(/"(\w+)":/g)?.map((k) => k.replace(/"/g, '').replace(':', ''));
    expect(keyOrder).toEqual(['id', 'path', 'reason', 'url']);
  });

  it('omits reason key when entry has no reason', () => {
    const config: AuditDepsConfig = {
      dev: {
        allowlist: [{ id: '1001', path: 'lodash', url: 'https://example.com' }],
      },
      prod: { allowlist: [] },
    };

    const json = serializeConfig(config);
    const devMatch = json.match(/"allowlist":\s*\[\s*\{([^}]+)\}/);
    const keyOrder = devMatch?.[1]?.match(/"(\w+)":/g)?.map((k) => k.replace(/"/g, '').replace(':', ''));
    expect(keyOrder).toEqual(['id', 'path', 'url']);
    expect(json).not.toContain('"reason"');
  });
});

describe(syncAllowlist, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `audit-deps-sync-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes updated config to disk after sync', async () => {
    const config: AuditDepsConfig = {
      dev: { allowlist: [], moderate: true },
      prod: { allowlist: [] },
    };
    const configPath = path.join(tempDir, 'config.json');

    const auditResults: AuditResult[] = [{ id: '1001', path: 'lodash', url: 'https://example.com/1001' }];

    const { syncResult, updatedConfig } = await syncAllowlist(config, 'dev', auditResults, configPath, fixedDate);

    expect(syncResult.added).toHaveLength(1);
    expect(syncResult.scope).toBe('dev');
    expect(updatedConfig.dev.allowlist).toHaveLength(1);

    const written: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    expect(written).toHaveProperty('dev.allowlist.length', 1);
    expect(written).toHaveProperty('dev.allowlist[0].id', '1001');
  });
});
