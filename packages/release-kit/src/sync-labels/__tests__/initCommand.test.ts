import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockGenerateCommand = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('../../discoverWorkspaces.ts'), () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../generateCommand.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, generateCommand: mockGenerateCommand };
});

const mockReportWriteResult = vi.hoisted(() => vi.fn());

vi.mock(import('@williamthorsen/node-monorepo-core'), () => ({
  reportWriteResult: mockReportWriteResult,
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { syncLabelsInitCommand } from '../initCommand.ts';
import { buildScopeLabels } from '../templates.ts';

describe(syncLabelsInitCommand, () => {
  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockGenerateCommand.mockReset();
    mockReportWriteResult.mockReset();
    mockWriteFileWithCheck.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 0 on success with workspaces', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/utils']);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(2);
    expect(mockGenerateCommand).toHaveBeenCalledOnce();
  });

  it('returns 0 on success for single-package repos', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(2);
  });

  it('returns 1 when workspace discovery throws', async () => {
    mockDiscoverWorkspaces.mockRejectedValue(new Error('filesystem error'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when generate fails', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(1);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when scaffolding fails', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'failed', filePath: 'some/file' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('skips generate in dry-run mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes force as overwrite option to writeFileWithCheck', async () => {
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

  it('scaffolds workflow and config files', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteFileWithCheck.mockReturnValue({ outcome: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/sync-labels.yaml', expect.any(String), {
      dryRun: false,
      overwrite: false,
    });
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.config/sync-labels.config.ts', expect.any(String), {
      dryRun: false,
      overwrite: false,
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
});
