import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditCommand } from '../commands.ts';
import {
  buildFakeCommandDependencies,
  buildLoadConfigResult,
  type FakeCommandDependencies,
  makeOptions,
} from '../test-utils/cli-fixtures.ts';

// -- auditCommand --

describe(auditCommand, () => {
  let capture: CapturedStdio;
  let dependencies: FakeCommandDependencies;

  beforeEach(() => {
    capture = captureStdio();
    dependencies = buildFakeCommandDependencies();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
  });

  it('returns 1 when config loading fails', async () => {
    dependencies.loadConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await auditCommand(makeOptions(), dependencies);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Config not found');
  });

  it('reports the failure and returns 1 when generating the audit-ci config fails', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.generateAuditCiConfig.mockRejectedValue(new Error('Cannot write audit-ci config'));

    const exitCode = await auditCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('v11y: Cannot write audit-ci config');
    expect(dependencies.runAudit).not.toHaveBeenCalled();
  });

  it('forwards stale entry warnings to stderr', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: ['GHSA-1234', 'GHSA-5678'],
      stderr: '',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(capture.stderr).toContain('stale allowlist entries in dev: GHSA-1234, GHSA-5678');
  });

  it('forwards audit-ci warnings to stderr', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({
      exitCode: 0,
      staleEntries: [],
      stderr: '',
      stdout: '',
      warnings: ['Some parse warning'],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(capture.stderr).toContain('warning: Some parse warning');
  });

  it('returns non-zero exit code when any scope fails', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit
      .mockReturnValueOnce({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] })
      .mockReturnValueOnce({ exitCode: 1, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions(), dependencies);

    expect(exitCode).toBe(1);
  });

  it('returns 0 when all scopes pass', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    const exitCode = await auditCommand(makeOptions(), dependencies);

    expect(exitCode).toBe(0);
  });

  it('writes deduplicated JSON in JSON mode', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({
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

    await auditCommand(makeOptions({ isJson: true, scopes: ['dev'] }), dependencies);

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual([{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }]);
  });

  it('writes stderr when stdout is empty and stderr has content', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({
      exitCode: 1,
      staleEntries: [],
      stderr: 'audit-ci error output',
      stdout: '',
      warnings: [],
    });

    await auditCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(capture.stderr).toContain('audit-ci error output');
  });

  it('deduplicates advisory IDs across scopes in JSON mode', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());

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

    dependencies.runAudit
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

    await auditCommand(makeOptions({ isJson: true }), dependencies);

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'GHSA-shared' }),
        expect.objectContaining({ id: 'GHSA-dev-only' }),
        expect.objectContaining({ id: 'GHSA-prod-only' }),
      ]),
    );
    expect(parsedOutput).toHaveLength(3);
  });

  it('audits both scopes when the options do not specify any scope', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runAudit.mockReturnValue({ exitCode: 0, staleEntries: [], stderr: '', stdout: '', warnings: [] });

    await auditCommand(makeOptions(), dependencies);

    expect(dependencies.runAudit).toHaveBeenCalledTimes(2);
  });
});
