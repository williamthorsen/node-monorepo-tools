import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCommand } from '../cli.ts';
import type { LoadConfigResult } from '../config.ts';
import { buildLoadConfigResult, callWithFakeTempDir, makeConfig, makeOptions } from '../test-utils/cli-fixtures.ts';

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
  const actualModule = await importOriginal<typeof import('../run-audit.ts')>();
  return {
    ...actualModule,
    runAudit: mocks.runAudit,
    runReport: mocks.runReport,
  };
});

vi.mock(import('../sync.ts'), async (importOriginal) => {
  const actualModule = await importOriginal<typeof import('../sync.ts')>();
  return {
    ...actualModule,
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
  mocks.withTempDir.mockImplementation(callWithFakeTempDir);
  mocks.generateAuditCiConfig.mockResolvedValue('/fake/tmp/audit-ci.json');
  mocks.scaffoldConfig.mockReturnValue({ configResult: { outcome: 'created' } });
  return capture;
}

// -- checkCommand --

describe(checkCommand, () => {
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

    const exitCode = await checkCommand(makeOptions());

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Config not found');
  });

  it('returns 0 when the report does not contain any vulnerabilities', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('No known vulnerabilities found.');
  });

  it('returns 1 and reports the failure when audit-ci fails to produce a report', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockImplementation(() => {
      throw new Error('audit-ci exited with status 1 without producing a report:\nError: spawn EPERM');
    });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('spawn EPERM');
    expect(capture.stdout).not.toContain('No known vulnerabilities found.');
  });

  it('returns 1 when unallowed vulnerabilities exist', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
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
    expect(capture.stdout).toContain('GHSA-bad');
  });

  it('classifies allowed vulnerabilities correctly', async () => {
    const config = makeConfig({
      dev: {
        allowlist: [{ id: 'GHSA-ok', path: 'safe-pkg', url: 'https://example.com/ok' }],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
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
    expect(capture.stdout).toContain('\u{2705}');
  });

  it('populates allowed entries with advisory fields from the audit result and metadata from the allowlist entry', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          {
            addedAt: '2026-04-01T00:00:00.000Z',
            id: 'GHSA-enriched',
            path: 'pkg',
            reason: 'Accepted risk',
            url: 'https://example.com/enriched',
          },
        ],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
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

    await checkCommand(makeOptions({ isJson: true, scopes: ['prod'] }));

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              addedAt: '2026-04-01T00:00:00.000Z',
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

  it('propagates ghsaId from audit result to allowed entry in JSON output', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          {
            id: 'GHSA-ghsa-test',
            path: 'pkg',
            url: 'https://example.com/ghsa-test',
          },
        ],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({
      results: [
        {
          ghsaId: 'GHSA-ghsa-test',
          id: 'GHSA-ghsa-test',
          path: 'pkg',
          paths: ['pkg'],
          severity: 'high',
          url: 'https://example.com/ghsa-test',
        },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ isJson: true, scopes: ['prod'] }));

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              ghsaId: 'GHSA-ghsa-test',
              id: 'GHSA-ghsa-test',
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
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    const exitCode = await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('GHSA-stale');
    expect(capture.stdout).toContain('not needed');
  });

  it('outputs JSON when the isJson option is true', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ isJson: true, scopes: ['prod'] }));

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toHaveProperty('prod');
  });

  it('checks both scopes when none are specified', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions());

    expect(mocks.runReport).toHaveBeenCalledTimes(2);
    expect(capture.stdout).toContain('Auditing dependencies');
    expect(capture.stdout).toContain('No known vulnerabilities found.');
  });

  it('displays prod before dev even when scopes are passed in reverse order', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [{ id: 'GHSA-prod-entry', path: 'pkg', url: 'https://example.com/prod' }],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-prod-entry', path: 'pkg', paths: ['pkg'], url: 'https://example.com/prod' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    await checkCommand(makeOptions({ scopes: ['dev', 'prod'] }));

    const prodIndex = capture.stdout.indexOf('\u{1F4E6} prod:');
    const devIndex = capture.stdout.indexOf('\u{1F527} dev:');
    expect(prodIndex).toBeGreaterThanOrEqual(0);
    expect(devIndex).toBeGreaterThanOrEqual(0);
    expect(prodIndex).toBeLessThan(devIndex);
  });

  it('forwards report stderr to process stderr', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({
      results: [],
      stdout: '',
      stderr: 'audit-ci diagnostic output',
      warnings: [],
    });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(capture.stderr).toContain('audit-ci diagnostic output');
  });

  it('forwards report warnings to stderr', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({
      results: [],
      stdout: '',
      stderr: '',
      warnings: ['Parse warning'],
    });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(capture.stderr).toContain('warning: Parse warning');
  });

  it('invokes runReport with reportType "full" when verbose is true', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['prod'], verbose: true }));

    expect(mocks.runReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'full' }));
  });

  it('omits reportType when verbose is false', async () => {
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult());
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    const call = mocks.runReport.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('reportType');
  });

  it('renders verbose text output when verbose is true and isJson is false', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          {
            addedAt: '2026-04-01T00:00:00.000Z',
            id: 'GHSA-allowed',
            path: 'pkg',
            reason: 'Accepted',
            url: 'https://example.com/allowed',
          },
        ],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
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

    expect(capture.stdout).toContain('\u{2705} GHSA-allowed');
    expect(capture.stdout).toContain('Example title');
    expect(capture.stdout).toContain('reason: Accepted');
  });

  it.each([
    ['compact', false],
    ['verbose', true],
  ])('renders %s text output in the style resolved for stdout', async (_format, verbose) => {
    const config = makeConfig({
      prod: {
        allowlist: [{ id: 'GHSA-allowed', path: 'pkg', url: 'https://example.com/allowed' }],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({
      results: [
        { id: 'GHSA-allowed', path: 'pkg', paths: ['pkg'], severity: 'moderate', url: 'https://example.com/allowed' },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    // Each stream gets a different style, so the assertion fails if the formatter receives the other stream's.
    await checkCommand(makeOptions({ scopes: ['prod'], styles: { stderr: 'rich', stdout: 'plain' }, verbose }));

    expect(capture.stdout).toContain('PASS  GHSA-allowed');
  });

  it('classifies below-threshold vulnerabilities separately and returns 0', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [],
        severityThreshold: 'high',
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({
      results: [
        { id: 'GHSA-low', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/low' },
        { id: 'GHSA-moderate', path: 'pkg2', paths: ['pkg2'], severity: 'moderate', url: 'https://example.com/mod' },
      ],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    const exitCode = await checkCommand(makeOptions({ isJson: true, scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          belowThreshold: expect.arrayContaining([
            expect.objectContaining({ id: 'GHSA-low' }),
            expect.objectContaining({ id: 'GHSA-moderate' }),
          ]),
          unallowed: [],
        }),
      }),
    );
  });

  it('classifies an allowlisted vulnerability as belowThreshold when its severity is below the threshold', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [{ id: 'GHSA-low', path: 'pkg', url: 'https://example.com/low' }],
        severityThreshold: 'high',
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({
      results: [{ id: 'GHSA-low', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/low' }],
      stdout: '',
      stderr: '',
      warnings: [],
    });

    const exitCode = await checkCommand(makeOptions({ isJson: true, scopes: ['prod'] }));

    expect(exitCode).toBe(0);
    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [],
          belowThreshold: [expect.objectContaining({ id: 'GHSA-low' })],
          stale: [],
        }),
      }),
    );
  });

  it('always passes severityThreshold "low" to generateAuditCiConfig regardless of config threshold', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [],
        severityThreshold: 'high',
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    mocks.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });

    await checkCommand(makeOptions({ scopes: ['prod'] }));

    expect(mocks.generateAuditCiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ severityThreshold: 'low' }),
      'prod',
      expect.any(String),
    );
  });

  it('renders verbose JSON output when both verbose and isJson are true', async () => {
    const config = makeConfig({
      prod: {
        allowlist: [
          { addedAt: '2026-04-01T00:00:00.000Z', id: 'GHSA-1', path: 'pkg', reason: 'r', url: 'https://example.com/1' },
        ],
      },
    });
    mocks.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
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

    await checkCommand(makeOptions({ isJson: true, scopes: ['prod'], verbose: true }));

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              addedAt: '2026-04-01T00:00:00.000Z',
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
