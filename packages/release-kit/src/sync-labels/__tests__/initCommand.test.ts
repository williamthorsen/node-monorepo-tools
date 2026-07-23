import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockGenerateCommand = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockReportError = vi.hoisted(() => vi.fn());
const mockReportWriteResult = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

vi.mock(import('../../discoverWorkspaces.ts'), () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../../loadConfig.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, loadConfig: mockLoadConfig };
});

vi.mock(import('../../validateConfig.ts'), () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock(import('../generateCommand.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, generateCommand: mockGenerateCommand };
});

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  reportError: mockReportError,
  reportWriteResult: mockReportWriteResult,
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { CONFIG_FILE_PATH } from '../../loadConfig.ts';
import { syncLabelsInitCommand } from '../initCommand.ts';
import { RETIRED_SYNC_LABELS_CONFIG_PATH } from '../retiredConfig.ts';
import { buildScopeLabels } from '../templates.ts';

/** Make only the given repo files exist. */
function givenExistingFiles(...paths: string[]): void {
  mockExistsSync.mockImplementation((path: string) => paths.includes(path));
}

/** Configure a loadable config whose validation succeeds with the given typed config. */
function givenValidConfig(config: Record<string, unknown>): void {
  mockLoadConfig.mockResolvedValue(config);
  mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });
}

describe(syncLabelsInitCommand, () => {
  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockExistsSync.mockReset();
    mockGenerateCommand.mockReset();
    mockLoadConfig.mockReset();
    mockReportError.mockReset();
    mockReportWriteResult.mockReset();
    mockValidateConfig.mockReset();
    mockWriteFileWithCheck.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 1 without writing when the retired sync-labels config exists', async () => {
    givenExistingFiles(RETIRED_SYNC_LABELS_CONFIG_PATH);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
    expect(mockReportError).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('writes workflow and config, then generates, when no config exists', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/utils']);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/sync-labels.yaml', expect.any(String), {
      dryRun: false,
      overwrite: false,
    });
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(CONFIG_FILE_PATH, expect.stringContaining('defineConfig'), {
      dryRun: false,
      overwrite: false,
    });
    expect(mockGenerateCommand).toHaveBeenCalledOnce();
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it('prints the repoLabels block instead of writing when the config already exists', async () => {
    givenExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    givenValidConfig({});
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(1);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      '.github/workflows/sync-labels.yaml',
      expect.any(String),
      expect.any(Object),
    );
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("'scope:core': { color: '00ff96'"));
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('seeds scope labels from retiredPackages when the config declares them', async () => {
    givenExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    givenValidConfig({
      retiredPackages: [{ name: '@acme/preflight', tagPrefix: 'preflight-v' }],
    });
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("'scope:preflight'"));
  });

  it('returns 1 when the existing config fails validation', async () => {
    givenExistingFiles(CONFIG_FILE_PATH);
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockLoadConfig.mockResolvedValue({ bad: true });
    mockValidateConfig.mockReturnValue({ config: {}, errors: ['bad config'], warnings: [] });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('returns 0 on success for single-package repos', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      CONFIG_FILE_PATH,
      expect.stringContaining('labels: {},'),
      expect.any(Object),
    );
  });

  it('returns 1 when workspace discovery throws', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockRejectedValue(new Error('filesystem error'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when generate fails', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(1);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when scaffolding fails', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'failed', filePath: 'some/file' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('skips generate in dry-run mode', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes force as overwrite option to writeFileWithCheck', async () => {
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun: false, force: true });

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      dryRun: false,
      overwrite: true,
    });
  });

  it.each([
    { outcome: 'created', dryRun: false },
    { outcome: 'overwritten', dryRun: false },
    { outcome: 'overwritten', dryRun: true },
    { outcome: 'up-to-date', dryRun: false },
    { outcome: 'skipped', dryRun: false },
  ])('calls reportWriteResult for $outcome outcome (dryRun=$dryRun)', async ({ outcome, dryRun }) => {
    const result = { filePath: 'test/path', outcome };
    givenExistingFiles();
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue(result);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun, force: false });

    expect(mockReportWriteResult).toHaveBeenCalledWith(result, dryRun);
    expect(mockReportWriteResult).toHaveBeenCalledTimes(2);
  });
});

describe(buildScopeLabels, () => {
  it('generates scope labels from workspace paths', () => {
    const result = buildScopeLabels(['packages/core', 'packages/utils']);

    expect(result).toStrictEqual([
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
      { name: 'scope:core', color: '00ff96', description: 'core package' },
      { name: 'scope:utils', color: '00ff96', description: 'utils package' },
    ]);
  });

  it('always includes scope:root', () => {
    const result = buildScopeLabels([]);

    expect(result).toStrictEqual([{ name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' }]);
  });

  it('extracts basename from nested paths', () => {
    const result = buildScopeLabels(['libs/shared/core']);

    expect(result).toHaveLength(2);
    expect(result[1]).toStrictEqual({ name: 'scope:core', color: '00ff96', description: 'core package' });
  });

  it('appends retired-package labels after workspace labels', () => {
    const result = buildScopeLabels(['packages/core'], ['preflight']);

    expect(result).toStrictEqual([
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
      { name: 'scope:core', color: '00ff96', description: 'core package' },
      { name: 'scope:preflight', color: '00ff96', description: 'preflight package (retired)' },
    ]);
  });
});
