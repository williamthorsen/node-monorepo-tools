import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncCommand } from '../cli.ts';
import type { LoadConfigResult } from '../config.ts';
import { makeConfig, makeOptions } from '../test-utils/cliFixtures.ts';
import type { V11yCheckConfig } from '../types.ts';
const mocks = vi.hoisted(() => ({
  generateAuditCiConfig: vi.fn<() => Promise<string>>(),
  loadConfig: vi.fn<() => Promise<LoadConfigResult>>(),
  runAudit: vi.fn(),
  runReport: vi.fn(),
  scaffoldConfig: vi.fn(),
  syncAllowlist: vi.fn(),
  withTempDir: vi.fn(),
}));

vi.mock(import('../config.ts'), () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock(import('../init/scaffold.ts'), () => ({
  scaffoldConfig: mocks.scaffoldConfig,
}));

vi.mock(import('../generate.ts'), () => ({
  generateAuditCiConfig: mocks.generateAuditCiConfig,
}));

vi.mock(import('../run-audit.ts'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('../run-audit.ts')>();
  return {
    ...actual,
    runAudit: mocks.runAudit,
    runReport: mocks.runReport,
  };
});

vi.mock(import('../sync.ts'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync.ts')>();
  return {
    ...actual,
    syncAllowlist: mocks.syncAllowlist,
  };
});

vi.mock(import('../tmp.ts'), () => ({
  withTempDir: mocks.withTempDir,
}));

// -- Suite setup --

/**
 * Opens a stdio capture and primes the mocks on which the command under test depends. The suite registers it, so that
 * every hook in this file is inside a describe.
 */
function primeSuite(): CapturedStdio {
  const capture = captureStdio();
  setupTempDir();
  mocks.generateAuditCiConfig.mockResolvedValue('/fake/tmp/audit-ci.json');
  mocks.scaffoldConfig.mockReturnValue({ configResult: { outcome: 'created' } });
  return capture;
}

// -- syncCommand --

describe(syncCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = primeSuite();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    vi.clearAllMocks();
  });

  it('returns 1 when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await syncCommand(makeOptions());

    expect(exitCode).toBe(1);
  });

  it('uses a stripped (empty) allowlist config when invoking runReport', async () => {
    const config = makeConfig({
      dev: { allowlist: [{ id: 'GHSA-existing', path: 'pkg', url: 'https://example.com' }] },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: config,
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    // Verify the allowlist was stripped (emptied) before generating the audit-ci config.
    expect(mocks.generateAuditCiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowlist: [] }),
      'dev',
      expect.any(String),
    );
  });

  it('prints text summary in non-JSON mode', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: ['a'], kept: [], removed: ['b', 'c'], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(capture.stdout).toContain('--- dev ---');
    expect(capture.stdout).toContain('added: 1');
    expect(capture.stdout).toContain('removed: 2');
  });

  it('prints JSON in json mode', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ json: true, scopes: ['dev'] }));

    const parsed: unknown = JSON.parse(capture.stdout);
    expect(parsed).toStrictEqual(expect.objectContaining({ added: [], kept: [], removed: [] }));
  });

  it('reports config creation when source is defaults', async () => {
    // First call returns defaults; second call (after scaffold) returns file.
    mocks.loadConfig
      .mockResolvedValueOnce({
        config: makeConfig(),
        configDir: '/fake/dir',
        configFilePath: '/fake/dir/v11y-check.config.json',
        configSource: 'defaults',
      })
      .mockResolvedValueOnce({
        config: makeConfig(),
        configDir: '/fake/dir',
        configFilePath: '/fake/dir/v11y-check.config.json',
        configSource: 'file',
      });
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(capture.stdout).toContain('Created config at');
  });

  it('scaffolds a config file when source is defaults', async () => {
    // First call returns defaults; second call (after scaffold) returns file.
    mocks.loadConfig
      .mockResolvedValueOnce({
        config: makeConfig(),
        configDir: '/fake/dir',
        configFilePath: '/fake/dir/v11y-check.config.json',
        configSource: 'defaults',
      })
      .mockResolvedValueOnce({
        config: makeConfig(),
        configDir: '/fake/dir',
        configFilePath: '/fake/dir/v11y-check.config.json',
        configSource: 'file',
      });
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(mocks.scaffoldConfig).toHaveBeenCalledWith({ dryRun: false });
  });

  it('does not scaffold when source is file', async () => {
    setupLoadConfig(undefined, 'file');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(mocks.scaffoldConfig).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffold fails', async () => {
    mocks.loadConfig.mockResolvedValueOnce({
      config: makeConfig(),
      configDir: '/fake/dir',
      configFilePath: '/fake/dir/v11y-check.config.json',
      configSource: 'defaults',
    });
    mocks.scaffoldConfig.mockReturnValue({ configResult: { outcome: 'failed' } });

    const exitCode = await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Failed to create config file');
  });
});

// region | Helpers

function setupLoadConfig(config?: V11yCheckConfig, source: 'defaults' | 'file' = 'file'): void {
  mocks.loadConfig.mockResolvedValue({
    config: config ?? makeConfig(),
    configDir: '/fake/dir',
    configFilePath: '/fake/dir/v11y-check.config.json',
    configSource: source,
  });
}

/**
 * Configures withTempDir mock to execute the callback with a fake temp path.
 *
 * Must be called before each test that exercises commands using temp dirs.
 */
function setupTempDir(): void {
  mocks.withTempDir.mockImplementation(async (fn: (dir: string) => Promise<unknown>) => fn('/fake/tmp'));
}

// endregion | Helpers
