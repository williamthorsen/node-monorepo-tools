import type { StreamStyles } from '@williamthorsen/nmr-core';
import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockGenerateCommand = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockPrintError = vi.hoisted(() => vi.fn());
const mockReadSyncLabelsWorkflowTemplate = vi.hoisted(() => vi.fn<() => string>(() => 'sync-labels workflow\n'));
const mockReportError = vi.hoisted(() => vi.fn());
const mockReportWriteResult = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../../loadConfig.ts'), async (importOriginal) => {
  const originalModule = await importOriginal();
  return { ...originalModule, loadConfig: mockLoadConfig };
});

vi.mock(import('../../validateConfig.ts'), () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock(import('../generateCommand.ts'), async (importOriginal) => {
  const originalModule = await importOriginal();
  return { ...originalModule, generateCommand: mockGenerateCommand };
});

vi.mock(import('../templates.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readSyncLabelsWorkflowTemplate: mockReadSyncLabelsWorkflowTemplate,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  printError: mockPrintError,
  reportError: mockReportError,
  reportWriteResult: mockReportWriteResult,
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { CONFIG_FILE_PATH } from '../../loadConfig.ts';
import { makeEmptyWorkspace, makeResolvedPackages, makeSinglePackage } from '../../test-utils/workspaceResolutions.ts';
import { syncLabelsInitCommand } from '../initCommand.ts';
import { RETIRED_SYNC_LABELS_CONFIG_PATH } from '../retiredConfig.ts';
import { buildScopeLabels } from '../templates.ts';

// The streams differ so that a helper given the other stream's style fails its assertion.
const SPLIT_STYLES: StreamStyles = { stderr: 'plain', stdout: 'rich' };

describe(syncLabelsInitCommand, () => {
  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockExistsSync.mockReset();
    mockGenerateCommand.mockReset();
    mockLoadConfig.mockReset();
    mockPrintError.mockReset();
    mockReadSyncLabelsWorkflowTemplate.mockReset();
    mockReportError.mockReset();
    mockReportWriteResult.mockReset();
    mockValidateConfig.mockReset();
    mockWriteFileWithCheck.mockReset();
  });

  it('returns 1 without writing when the retired sync-labels config exists', async () => {
    stubExistingFiles(RETIRED_SYNC_LABELS_CONFIG_PATH);

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
    expect(mockReportError).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('writes workflow and config, then generates, when the config does not exist', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/utils']));
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/sync-labels.yaml', expect.any(String), {
      isDryRun: false,
      shouldOverwrite: false,
    });
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(CONFIG_FILE_PATH, expect.stringContaining('defineConfig'), {
      isDryRun: false,
      shouldOverwrite: false,
    });
    expect(mockGenerateCommand).toHaveBeenCalledExactlyOnceWith({ styles: SPLIT_STYLES });
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it('prints the repoLabels block instead of writing when the config already exists', async () => {
    stubExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    stubValidConfig({});
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(1);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      '.github/workflows/sync-labels.yaml',
      expect.any(String),
      expect.any(Object),
    );
    expect(silencedConsole.info).toHaveBeenCalledWith(expect.stringContaining("'scope:core': { color: '00ff96'"));
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('seeds scope labels from retiredPackages when the config declares them', async () => {
    stubExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    stubValidConfig({
      retiredPackages: [{ name: '@acme/preflight', tagPrefix: 'preflight-v' }],
    });
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using silencedConsole = silenceConsole(['info']);

    await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(silencedConsole.info).toHaveBeenCalledWith(expect.stringContaining("'scope:preflight'"));
  });

  it('reads the named config and names it in the paste instructions', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    stubValidConfig({});
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({
      configPath: 'elsewhere/alternative.config.ts',
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
    });

    expect(exitCode).toBe(0);
    expect(mockLoadConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
    expect(silencedConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('elsewhere/alternative.config.ts already exists'),
    );
    expect(silencedConsole.info).toHaveBeenCalledWith(
      expect.stringContaining('Paste the block above into elsewhere/alternative.config.ts'),
    );
    expect(mockWriteFileWithCheck).not.toHaveBeenCalledWith(CONFIG_FILE_PATH, expect.anything(), expect.anything());
  });

  it('returns 1 rather than scaffolding when the named config does not exist', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);
    using _stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({
      configPath: 'elsewhere/absent.config.ts',
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
    });

    expect(exitCode).toBe(1);
    expect(mockReportError).toHaveBeenCalledWith(
      expect.stringContaining('Config file not found: /repo/elsewhere/absent.config.ts'),
    );
    expect(mockWriteFileWithCheck).not.toHaveBeenCalledWith(CONFIG_FILE_PATH, expect.anything(), expect.anything());
  });

  it('returns 1 when the existing config fails validation', async () => {
    stubExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockLoadConfig.mockResolvedValue({ bad: true });
    mockValidateConfig.mockReturnValue({ config: {}, errors: ['bad config'], warnings: [] });
    using _silencedConsole = silenceConsole(['info']);
    using _stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith('bad config', 'plain');
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('returns 0 on success for single-package repos', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      CONFIG_FILE_PATH,
      expect.stringContaining('labels: {},'),
      expect.any(Object),
    );
  });

  it('returns 1 when workspace discovery throws', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockImplementation(() => {
      throw new Error('filesystem error');
    });
    using _silencedConsole = silenceConsole(['info']);
    using _stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when the workspace does not resolve to any package', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeEmptyWorkspace('all-excluded'));
    using _silencedConsole = silenceConsole(['info']);
    using stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
    expect(stdioCapture.stderr).toContain('No workspace package to label.');
  });

  it('returns 1 when generate fails', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockGenerateCommand.mockResolvedValue(1);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when scaffolding fails', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'failed', filePath: 'some/file' });
    using _silencedConsole = silenceConsole(['info']);
    using _stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('returns 1 without writing when the workflow template cannot be read', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockReadSyncLabelsWorkflowTemplate.mockImplementation(() => {
      throw new Error('Failed to read bundled template at /pkg/templates/sync-labels.yaml.template: ENOENT');
    });
    using _silencedConsole = silenceConsole(['info']);
    using stdioCapture = captureStdio();

    const exitCode = await syncLabelsInitCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(1);
    expect(stdioCapture.stderr).toContain('/pkg/templates/sync-labels.yaml.template');
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('skips generate in dry-run mode', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);

    const exitCode = await syncLabelsInitCommand({ isDryRun: true, shouldForce: false, styles: SPLIT_STYLES });

    expect(exitCode).toBe(0);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes shouldForce as shouldOverwrite to writeFileWithCheck', async () => {
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    using _silencedConsole = silenceConsole(['info']);

    await syncLabelsInitCommand({ isDryRun: false, shouldForce: true, styles: SPLIT_STYLES });

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      isDryRun: false,
      shouldOverwrite: true,
    });
  });

  it.each([
    { outcome: 'created', isDryRun: false },
    { outcome: 'overwritten', isDryRun: false },
    { outcome: 'overwritten', isDryRun: true },
    { outcome: 'up-to-date', isDryRun: false },
    { outcome: 'skipped', isDryRun: false },
  ])('calls reportWriteResult for $outcome outcome (isDryRun=$isDryRun)', async ({ outcome, isDryRun }) => {
    const result = { filePath: 'test/path', outcome };
    stubExistingFiles();
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue(result);
    using _silencedConsole = silenceConsole(['info']);

    await syncLabelsInitCommand({ isDryRun, shouldForce: false, styles: SPLIT_STYLES });

    expect(mockReportWriteResult).toHaveBeenCalledWith(result, isDryRun, SPLIT_STYLES);
    expect(mockReportWriteResult).toHaveBeenCalledTimes(2);
  });
});

describe(buildScopeLabels, () => {
  it('generates scope labels from workspace paths', () => {
    const result = buildScopeLabels(['packages/core', 'packages/utils']);

    expect(result).toStrictEqual([
      { name: 'scope:root', color: '00ff96' },
      { name: 'scope:core', color: '00ff96' },
      { name: 'scope:utils', color: '00ff96' },
    ]);
  });

  it('always includes scope:root', () => {
    const result = buildScopeLabels([]);

    expect(result).toStrictEqual([{ name: 'scope:root', color: '00ff96' }]);
  });

  it('extracts basename from nested paths', () => {
    const result = buildScopeLabels(['libs/shared/core']);

    expect(result).toHaveLength(2);
    expect(result[1]).toStrictEqual({ name: 'scope:core', color: '00ff96' });
  });

  it('appends retired-package labels after workspace labels', () => {
    const result = buildScopeLabels(['packages/core'], ['preflight']);

    expect(result).toStrictEqual([
      { name: 'scope:root', color: '00ff96' },
      { name: 'scope:core', color: '00ff96' },
      { name: 'scope:preflight', color: '00ff96' },
    ]);
  });

  // Retired scopes are indistinguishable from live ones by design:
  // Describing only the retired ones would give them the visual prominence that the bare-label rule exists to remove.
  it('does not describe any scope, retired ones included', () => {
    const result = buildScopeLabels(['packages/core'], ['preflight']);

    expect(result.every((label) => label.description === undefined)).toBe(true);
  });
});

// region | Helpers

/** Makes only the given repo files exist. */
function stubExistingFiles(...paths: string[]): void {
  mockExistsSync.mockImplementation((path: string) => paths.includes(path));
}

/** Configures a loadable config whose validation succeeds with the given typed config. */
function stubValidConfig(config: Record<string, unknown>): void {
  mockLoadConfig.mockResolvedValue(config);
  mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });
}

// endregion | Helpers
