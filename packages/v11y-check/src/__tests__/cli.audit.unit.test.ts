import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditCommand } from '../cli.ts';
import type { LoadConfigResult } from '../config.ts';
import { makeConfig, makeOptions } from '../test-utils/cli-fixtures.ts';
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

// -- auditCommand --

describe(auditCommand, () => {
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

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Config not found');
  });

  it('forwards stale entry warnings to stderr', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: ['GHSA-1234', 'GHSA-5678'],
      stderr: '',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(capture.stderr).toContain('stale allowlist entries in dev: GHSA-1234, GHSA-5678');
  });

  it('forwards audit-ci warnings to stderr', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: [],
      stderr: '',
      stdout: '',
      warnings: ['Some parse warning'],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(capture.stderr).toContain('warning: Some parse warning');
  });

  it('returns non-zero exit code when any scope fails', async () => {
    setupLoadConfig();
    mocks.runAudit
      .mockReturnValueOnce({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] })
      .mockReturnValueOnce({ exitCode: 1, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(1);
  });

  it('returns 0 when all scopes pass', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(0);
  });

  it('writes deduplicated JSON in JSON mode', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: [],
      stderr: '',
      stdout: JSON.stringify({
        advisories: {
          'GHSA-1': { id: 'GHSA-1', module_name: 'pkg', url: 'https://example.com/1', findings: [{ paths: ['pkg'] }] },
        },
      }),
      warnings: [],
    });

    await auditCommand(makeOptions({ json: true, scopes: ['dev'] }));

    const parsed: unknown = JSON.parse(capture.stdout);
    expect(parsed).toStrictEqual([{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }]);
  });

  it('writes stderr when stdout is empty and stderr has content', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({
      exitCode: 1,
      staleEntries: [],
      stderr: 'audit-ci error output',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(capture.stderr).toContain('audit-ci error output');
  });

  it('deduplicates advisory IDs across scopes in JSON mode', async () => {
    setupLoadConfig();

    const sharedAdvisory = {
      id: 'GHSA-shared',
      module_name: 'shared-pkg',
      url: 'https://example.com/shared',
      findings: [{ paths: ['shared-pkg'] }],
    };
    const devOnlyAdvisory = {
      id: 'GHSA-dev-only',
      module_name: 'dev-pkg',
      url: 'https://example.com/dev',
      findings: [{ paths: ['dev-pkg'] }],
    };
    const prodOnlyAdvisory = {
      id: 'GHSA-prod-only',
      module_name: 'prod-pkg',
      url: 'https://example.com/prod',
      findings: [{ paths: ['prod-pkg'] }],
    };

    mocks.runAudit
      .mockReturnValueOnce({
        exitCode: 1,
        staleEntries: [],
        stderr: '',
        stdout: JSON.stringify({
          advisories: { 'GHSA-shared': sharedAdvisory, 'GHSA-dev-only': devOnlyAdvisory },
        }),
        warnings: [],
      })
      .mockReturnValueOnce({
        exitCode: 1,
        staleEntries: [],
        stderr: '',
        stdout: JSON.stringify({
          advisories: { 'GHSA-shared': sharedAdvisory, 'GHSA-prod-only': prodOnlyAdvisory },
        }),
        warnings: [],
      });

    await auditCommand(makeOptions({ json: true }));

    const parsed: unknown = JSON.parse(capture.stdout);
    expect(parsed).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'GHSA-shared' }),
        expect.objectContaining({ id: 'GHSA-dev-only' }),
        expect.objectContaining({ id: 'GHSA-prod-only' }),
      ]),
    );
    expect(parsed).toHaveLength(3);
  });

  it('audits both scopes when the options do not specify any scope', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    await auditCommand(makeOptions());

    expect(mocks.runAudit).toHaveBeenCalledTimes(2);
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
