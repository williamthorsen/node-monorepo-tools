import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadConfigResult } from '../src/config.ts';
import type { AuditDepsConfig, CommandOptions } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  generateAuditCiConfig: vi.fn<() => Promise<string>>(),
  loadConfig: vi.fn<() => Promise<LoadConfigResult>>(),
  mkdirAsync: vi.fn<() => Promise<string | undefined>>(),
  runAudit: vi.fn(),
  runReport: vi.fn(),
  syncAllowlist: vi.fn(),
  withTempDir: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: mocks.mkdirAsync,
  };
});

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

vi.mock('../src/tmp.ts', () => ({
  withTempDir: mocks.withTempDir,
}));

import { auditCommand, checkCommand, syncCommand } from '../src/cli.ts';

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
  return { json: false, scopes: [], verbose: false, ...overrides };
}

function setupLoadConfig(config?: AuditDepsConfig, source: 'defaults' | 'file' = 'file'): void {
  mocks.loadConfig.mockResolvedValue({
    config: config ?? makeConfig(),
    configDir: '/fake/dir',
    configFilePath: '/fake/dir/audit-deps.config.json',
    configSource: source,
  });
}

/**
 * Configure withTempDir mock to execute the callback with a fake temp path.
 *
 * Must be called before each test that exercises commands using temp dirs.
 */
function setupTempDir(): void {
  mocks.withTempDir.mockImplementation(async (fn: (dir: string) => Promise<unknown>) => fn('/fake/tmp'));
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
  setupTempDir();
  mocks.generateAuditCiConfig.mockResolvedValue('/fake/tmp/audit-ci.json');
  mocks.mkdirAsync.mockResolvedValue(undefined);
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

    const parsed: unknown = JSON.parse(stdoutOutput);
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

    expect(stderrOutput).toContain('audit-ci error output');
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

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'GHSA-shared' }),
        expect.objectContaining({ id: 'GHSA-dev-only' }),
        expect.objectContaining({ id: 'GHSA-prod-only' }),
      ]),
    );
    expect(parsed).toHaveLength(3);
  });

  it('audits both scopes when no scopes are specified', async () => {
    setupLoadConfig();
    mocks.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    await auditCommand(makeOptions());

    expect(mocks.runAudit).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// checkCommand
// ---------------------------------------------------------------------------

describe(checkCommand, () => {
  it('returns 1 when config loading fails', async () => {
    mocks.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await checkCommand(makeOptions());

    expect(exitCode).toBe(1);
    expect(stderrOutput).toContain('Config not found');
  });

  it('returns 0 when no vulnerabilities are found', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain('(none)');
  });

  it('returns 1 when unallowed vulnerabilities exist', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({
      results: [
        { id: 'GHSA-bad', path: 'bad-pkg', paths: ['bad-pkg'], severity: 'high', url: 'https://example.com/bad' },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(1);
    expect(stdoutOutput).toContain('GHSA-bad');
  });

  it('classifies allowed vulnerabilities correctly', async () => {
    const config = makeConfig({
      dev: {
        allowlist: [{ id: 'GHSA-ok', path: 'safe-pkg', url: 'https://example.com/ok' }],
      },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({
      results: [
        { id: 'GHSA-ok', path: 'safe-pkg', paths: ['safe-pkg'], severity: 'moderate', url: 'https://example.com/ok' },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    const exitCode = await checkCommand(makeOptions({ scopes: ['dev'] }));

    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain('allowed');
  });

  it('populates allowed entries with advisory fields from the audit result and metadata from the allowlist entry', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          {
            addedAt: '2026-04-01',
            id: 'GHSA-enriched',
            path: 'pkg',
            reason: 'Accepted risk',
            url: 'https://example.com/enriched',
          },
        ],
      },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({
      results: [
        {
          cvss: { score: 7.5 },
          description: 'Detailed description',
          id: 'GHSA-enriched',
          path: 'pkg',
          paths: ['pkg', 'root>pkg'],
          severity: 'high',
          title: 'Prototype pollution',
          url: 'https://example.com/enriched',
        },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ json: true, scopes: ['prod'] }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              addedAt: '2026-04-01',
              cvss: { score: 7.5 },
              description: 'Detailed description',
              id: 'GHSA-enriched',
              paths: ['pkg', 'root>pkg'],
              reason: 'Accepted risk',
              severity: 'high',
              title: 'Prototype pollution',
            }),
          ],
        }),
      }),
    );
  });

  it('detects stale allowlist entries and returns 0', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [{ id: 'GHSA-stale', path: 'gone-pkg', url: 'https://example.com/stale' }],
      },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain('GHSA-stale');
    expect(stdoutOutput).toContain('not needed');
  });

  it('outputs JSON when json option is true', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ json: true, scopes: ['prod'] }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toHaveProperty('prod');
  });

  it('checks both scopes when none are specified', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions());

    expect(mocks.runReport).toHaveBeenCalledTimes(2);
    expect(stdoutOutput).toContain('prod');
    expect(stdoutOutput).toContain('dev');
  });

  it('displays prod before dev even when scopes are passed in reverse order', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['dev', 'prod'] }));

    const prodIndex = stdoutOutput.indexOf('prod');
    const devIndex = stdoutOutput.indexOf('dev');
    expect(prodIndex).toBeGreaterThanOrEqual(0);
    expect(devIndex).toBeGreaterThanOrEqual(0);
    expect(prodIndex).toBeLessThan(devIndex);
  });

  it('forwards report stderr to process stderr', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({
      results: [],
      stdout: '',
      stderr: 'audit-ci diagnostic output',
      warnings: [],
    });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(stderrOutput).toContain('audit-ci diagnostic output');
  });

  it('forwards report warnings to stderr', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({
      results: [],
      stdout: '',
      stderr: '',
      warnings: ['Parse warning'],
    });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(stderrOutput).toContain('warning: Parse warning');
  });

  it('invokes runReport with reportType "full" when verbose is true', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['prod'], verbose: true }));

    expect(mocks.runReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'full' }));
  });

  it('omits reportType when verbose is false', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    const call = mocks.runReport.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('reportType');
  });

  it('renders verbose text output when verbose is true and json is false', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          {
            addedAt: '2026-04-01',
            id: 'GHSA-allowed',
            path: 'pkg',
            reason: 'Accepted',
            url: 'https://example.com/allowed',
          },
        ],
      },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({
      results: [
        {
          description: 'Detailed description',
          id: 'GHSA-allowed',
          path: 'pkg',
          paths: ['pkg'],
          severity: 'moderate',
          title: 'Example title',
          url: 'https://example.com/allowed',
        },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ scopes: ['prod'], verbose: true }));

    expect(stdoutOutput).toContain('\u{26A0}\u{FE0F} GHSA-allowed');
    expect(stdoutOutput).toContain('Example title');
    expect(stdoutOutput).toContain('reason: Accepted');
  });

  it('renders verbose JSON output when both verbose and json are true', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [{ addedAt: '2026-04-01', id: 'GHSA-1', path: 'pkg', reason: 'r', url: 'https://example.com/1' }],
      },
    });
    setupLoadConfig(config);
    mocks.runReport.mockReturnValue({
      results: [
        {
          cvss: { score: 7.5 },
          description: 'desc',
          id: 'GHSA-1',
          path: 'pkg',
          paths: ['pkg'],
          severity: 'high',
          title: 'title',
          url: 'https://example.com/1',
        },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ json: true, scopes: ['prod'], verbose: true }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              addedAt: '2026-04-01',
              cvss: { score: 7.5 },
              description: 'desc',
              reason: 'r',
              title: 'title',
            }),
          ],
        }),
      }),
    );
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

    expect(stdoutOutput).toContain('--- dev ---');
    expect(stdoutOutput).toContain('added: 1');
    expect(stdoutOutput).toContain('removed: 2');
  });

  it('prints JSON in json mode', async () => {
    setupLoadConfig();
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ json: true, scopes: ['dev'] }));

    const parsed: unknown = JSON.parse(stdoutOutput);
    expect(parsed).toStrictEqual(expect.objectContaining({ added: [], kept: [], removed: [] }));
  });

  it('reports config creation when source is defaults', async () => {
    setupLoadConfig(undefined, 'defaults');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(stdoutOutput).toContain('Created config at');
  });

  it('creates config directory when source is defaults', async () => {
    setupLoadConfig(undefined, 'defaults');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(mocks.mkdirAsync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('does not create config directory when source is file', async () => {
    setupLoadConfig(undefined, 'file');
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    mocks.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }));

    expect(mocks.mkdirAsync).not.toHaveBeenCalled();
  });
});
