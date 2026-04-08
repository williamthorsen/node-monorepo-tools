import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditDepsConfig, CommandOptions } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  generateAuditCiConfig: vi.fn<() => Promise<string>>(),
  loadConfig: vi.fn<() => Promise<{ config: AuditDepsConfig; configDir: string; configFilePath: string }>>(),
  runAudit: vi.fn(),
  runReport: vi.fn(),
  syncAllowlist: vi.fn(),
}));

vi.mock('../src/config.ts', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../src/generate.ts', () => ({
  generateAuditCiConfig: mocks.generateAuditCiConfig,
}));

vi.mock('../src/run-audit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/run-audit.ts')>();
  return {
    ...actual,
    runAudit: mocks.runAudit,
    runReport: mocks.runReport,
  };
});

vi.mock('../src/sync.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sync.ts')>();
  return {
    ...actual,
    syncAllowlist: mocks.syncAllowlist,
  };
});

import { auditCommand, generateCommand, reportCommand, syncCommand } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AuditDepsConfig>): AuditDepsConfig {
  return {
    dev: { allowlist: [] },
    prod: { allowlist: [] },
    ...overrides,
  };
}

function makeOptions(overrides?: Partial<CommandOptions>): CommandOptions {
  return { json: false, scopes: [], ...overrides };
}

function setupLoadConfig(config?: AuditDepsConfig): void {
  mocks.loadConfig.mockResolvedValue({
    config: config ?? makeConfig(),
    configDir: '/fake/dir',
    configFilePath: '/fake/dir/audit-deps.config.json',
  });
}

// ---------------------------------------------------------------------------
// Stderr / stdout capture helpers
// ---------------------------------------------------------------------------

let stderrOutput: string;
let stdoutOutput: string;

beforeEach(() => {
  stderrOutput = '';
  stdoutOutput = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrOutput += String(chunk);
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutOutput += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// auditCommand
// ---------------------------------------------------------------------------

describe(auditCommand, () => {
  it('returns 1 when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(1);
    expect(stderrOutput).toContain('Config not found');
  });

  it('forwards stale entry warnings to stderr', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: ['GHSA-1234', 'GHSA-5678'],
      stderr: '',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(stderrOutput).toContain('stale allowlist entries in dev: GHSA-1234, GHSA-5678');
  });

  it('forwards audit-ci warnings to stderr', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: [],
      stderr: '',
      stdout: '',
      warnings: ['Some parse warning'],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(stderrOutput).toContain('warning: Some parse warning');
  });

  it('returns non-zero exit code when any scope fails', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');
    mocks.runAudit
      .mockReturnValueOnce({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] })
      .mockReturnValueOnce({ exitCode: 1, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(1);
  });

  it('returns 0 when all scopes pass', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');
    mocks.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions());

    expect(exitCode).toBe(0);
  });

  it('writes deduplicated JSON in JSON mode', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
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

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toEqual([{ id: 'GHSA-1', path: 'pkg', url: 'https://example.com/1' }]);
  });

  it('writes stderr when stdout is empty and stderr has content', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runAudit.mockReturnValue({
      exitCode: 1,
      staleEntries: [],
      stderr: 'audit-ci error output',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }));

    expect(stderrOutput).toContain('audit-ci error output');
  });

  it('deduplicates advisory IDs across scopes in JSON mode', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');

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

    const parsed = JSON.parse(stdoutOutput) as Array<{ id: string }>;
    const ids = parsed.map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('GHSA-shared');
    expect(ids).toContain('GHSA-dev-only');
    expect(ids).toContain('GHSA-prod-only');
    // Verify no duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('audits both scopes when no scopes are specified', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');
    mocks.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    await auditCommand(makeOptions());

    expect(mocks.runAudit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// reportCommand
// ---------------------------------------------------------------------------

describe(reportCommand, () => {
  it('returns 1 when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await reportCommand(makeOptions());

    expect(exitCode).toBe(1);
  });

  it('deduplicates results across scopes', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');

    const sharedResult = { id: 'GHSA-dup', path: 'lodash', url: 'https://example.com/GHSA-dup' };
    mocks.runReport
      .mockReturnValueOnce({ results: [sharedResult], stdout: '', stderr: '', warnings: [] })
      .mockReturnValueOnce({ results: [sharedResult], stdout: '', stderr: '', warnings: [] });

    await reportCommand(makeOptions());

    // Only one line for the deduplicated result
    const lines = stdoutOutput.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('GHSA-dup');
  });

  it('returns 0 even when vulnerabilities exist', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-1', path: 'pkg', url: 'https://example.com' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    const exitCode = await reportCommand(makeOptions({ scopes: ['dev'] }));

    expect(exitCode).toBe(0);
  });

  it('prints "No vulnerabilities found." when results are empty', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await reportCommand(makeOptions({ scopes: ['dev'] }));

    expect(stdoutOutput).toContain('No vulnerabilities found.');
  });

  it('outputs JSON when json option is true', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-1', path: 'pkg', url: 'https://example.com' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await reportCommand(makeOptions({ json: true, scopes: ['dev'] }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toEqual([{ id: 'GHSA-1', path: 'pkg', url: 'https://example.com' }]);
  });

  it('forwards report warnings to stderr', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({
      results: [],
      stdout: '',
      stderr: '',
      warnings: ['Parse warning'],
    });

    await reportCommand(makeOptions({ scopes: ['dev'] }));

    expect(stderrOutput).toContain('warning: Parse warning');
  });
});

// ---------------------------------------------------------------------------
// syncCommand
// ---------------------------------------------------------------------------

describe(syncCommand, () => {
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
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: config,
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    // The first generateAuditCiConfig call should receive a stripped scope with empty allowlist
    expect(mocks.generateAuditCiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowlist: [] }),
      'dev',
      '/fake/dir',
      undefined,
    );
  });

  it('prints text summary in non-JSON mode', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: ['a'], kept: [], removed: ['b', 'c'], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(stdoutOutput).toContain('--- dev ---');
    expect(stdoutOutput).toContain('added: 1');
    expect(stdoutOutput).toContain('removed: 2');
  });

  it('prints JSON in json mode', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ json: true, scopes: ['dev'] }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toEqual(expect.objectContaining({ added: [], kept: [], removed: [] }));
  });

  it('wraps generateAuditCiConfig errors with scope context', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(syncCommand(makeOptions({ scopes: ['dev'] }))).rejects.toThrow(
      "Failed to generate config for scope 'dev': EACCES: permission denied",
    );
  });

  it('throws when post-sync generateAuditCiConfig fails', async () => {
    const config = makeConfig();
    setupLoadConfig(config);

    // First call (stripped config) succeeds
    mocks.generateAuditCiConfig.mockResolvedValueOnce('/fake/out/audit-ci.dev.json');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: config,
    });

    // Second call (post-sync regeneration) fails
    mocks.generateAuditCiConfig.mockRejectedValueOnce(new Error('Disk full'));

    await expect(syncCommand(makeOptions({ scopes: ['dev'] }))).rejects.toThrow(
      "Failed to generate config for scope 'dev'",
    );
  });
});

// ---------------------------------------------------------------------------
// generateCommand
// ---------------------------------------------------------------------------

describe(generateCommand, () => {
  it('returns 1 when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await generateCommand(makeOptions());

    expect(exitCode).toBe(1);
  });

  it('prints generated paths', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig
      .mockResolvedValueOnce('/fake/out/audit-ci.dev.json')
      .mockResolvedValueOnce('/fake/out/audit-ci.prod.json');

    await generateCommand(makeOptions());

    expect(stdoutOutput).toContain('Generated: /fake/out/audit-ci.dev.json');
    expect(stdoutOutput).toContain('Generated: /fake/out/audit-ci.prod.json');
  });

  it('generates only the requested scope', async () => {
    setupLoadConfig();
    mocks.generateAuditCiConfig.mockResolvedValue('/fake/out/audit-ci.prod.json');

    await generateCommand(makeOptions({ scopes: ['prod'] }));

    expect(mocks.generateAuditCiConfig).toHaveBeenCalledTimes(1);
    expect(stdoutOutput).toContain('Generated: /fake/out/audit-ci.prod.json');
    expect(stdoutOutput).not.toContain('audit-ci.dev.json');
  });
});
