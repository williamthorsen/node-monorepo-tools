import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { syncCommand } from '../commands.ts';
import {
  buildFakeCommandDependencies,
  buildLoadConfigResult,
  type FakeCommandDependencies,
  makeConfig,
  makeOptions,
} from '../test-utils/cli-fixtures.ts';

// -- syncCommand --

describe(syncCommand, () => {
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

    const exitCode = await syncCommand(makeOptions(), dependencies);

    expect(exitCode).toBe(1);
  });

  it('uses a stripped (empty) allowlist config when invoking runReport', async () => {
    const config = makeConfig({
      dev: { allowlist: [{ id: 'GHSA-existing', url: 'https://example.com' }] },
    });
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult(config));
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: config,
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    // Verify the allowlist was stripped (emptied) before generating the audit-ci config.
    expect(dependencies.generateAuditCiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowlist: [] }),
      'dev',
      expect.any(String),
    );
  });

  it('prints text summary in non-JSON mode', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: {
        added: [{ id: 'GHSA-a', paths: ['x>a'], url: 'https://example.com/a' }],
        kept: [],
        removed: [
          { id: 'GHSA-b', url: 'https://example.com/b' },
          { id: 'GHSA-c', url: 'https://example.com/c' },
        ],
        scope: 'dev',
      },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(capture.stdout).toContain('--- dev ---');
    expect(capture.stdout).toContain('added: 1\n    GHSA-a\n      x>a\n');
    expect(capture.stdout).toContain('removed: 2\n    GHSA-b\n    GHSA-c\n');
  });

  it('prints JSON in json mode, with the chains of each added entry', async () => {
    const addedEntry = { id: 'GHSA-a', paths: ['x>a', 'y>a'], url: 'https://example.com/a' };
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: { added: [addedEntry], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ isJson: true, scopes: ['dev'] }), dependencies);

    const parsedOutput: unknown = JSON.parse(capture.stdout);
    expect(parsedOutput).toStrictEqual(expect.objectContaining({ added: [addedEntry], kept: [], removed: [] }));
  });

  it('reports config creation when source is defaults', async () => {
    // First call returns defaults; second call (after scaffold) returns file.
    dependencies.loadConfig
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
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(capture.stdout).toContain('Created config at');
  });

  it('scaffolds a config file when source is defaults', async () => {
    // First call returns defaults; second call (after scaffold) returns file.
    dependencies.loadConfig
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
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(dependencies.scaffoldConfig).toHaveBeenCalledWith({ isDryRun: false });
  });

  it('does not scaffold when source is file', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult(undefined, 'file'));
    dependencies.runReport.mockReturnValue({ results: [], stdout: '', stderr: '', warnings: [] });
    dependencies.syncAllowlist.mockResolvedValue({
      syncResult: { added: [], kept: [], removed: [], scope: 'dev' },
      updatedConfig: makeConfig(),
    });

    await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(dependencies.scaffoldConfig).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffold fails', async () => {
    dependencies.loadConfig.mockResolvedValueOnce({
      config: makeConfig(),
      configDir: '/fake/dir',
      configFilePath: '/fake/dir/v11y-check.config.json',
      configSource: 'defaults',
    });
    dependencies.scaffoldConfig.mockReturnValue({
      configResult: { filePath: '.config/v11y-check.config.json', outcome: 'failed' },
    });

    const exitCode = await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Failed to create config file');
  });

  it('reports the failure and returns 1 when reloading the scaffolded config fails', async () => {
    dependencies.loadConfig
      .mockResolvedValueOnce(buildLoadConfigResult(makeConfig(), 'defaults'))
      .mockRejectedValueOnce(new Error('Scaffolded config is invalid'));

    const exitCode = await syncCommand(makeOptions({ scopes: ['dev'] }), dependencies);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('v11y: Scaffolded config is invalid');
    expect(dependencies.runReport).not.toHaveBeenCalled();
  });

  it('returns 1 without syncing any scope when a later scope fails to produce a report', async () => {
    dependencies.loadConfig.mockResolvedValue(buildLoadConfigResult());
    dependencies.runReport
      .mockReturnValueOnce({ results: [], stdout: '{}', stderr: '', warnings: [] })
      .mockImplementationOnce(() => {
        throw new Error('audit-ci exited with status 1 without producing a report');
      });

    const exitCode = await syncCommand(makeOptions({ scopes: ['prod', 'dev'] }), dependencies);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('without producing a report');
    expect(dependencies.syncAllowlist).not.toHaveBeenCalled();
  });
});
