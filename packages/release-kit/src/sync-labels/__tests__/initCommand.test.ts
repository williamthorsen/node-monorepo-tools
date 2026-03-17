import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockGenerateCommand = vi.hoisted(() => vi.fn());
const mockWriteIfAbsent = vi.hoisted(() => vi.fn());

vi.mock(import('../../discoverWorkspaces.ts'), () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../generateCommand.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, generateCommand: mockGenerateCommand };
});

vi.mock(import('../scaffold.ts'), () => ({
  writeIfAbsent: mockWriteIfAbsent,
}));

import { syncLabelsInitCommand } from '../initCommand.ts';
import { buildScopeLabels } from '../templates.ts';

describe(syncLabelsInitCommand, () => {
  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockGenerateCommand.mockReset();
    mockWriteIfAbsent.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 0 on success with workspaces', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/utils']);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteIfAbsent.mockReturnValue({ action: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteIfAbsent).toHaveBeenCalledTimes(2);
    expect(mockGenerateCommand).toHaveBeenCalledOnce();
  });

  it('returns 0 on success for single-package repos', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteIfAbsent.mockReturnValue({ action: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(mockWriteIfAbsent).toHaveBeenCalledTimes(2);
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
    mockWriteIfAbsent.mockReturnValue({ action: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns 1 when scaffolding fails', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteIfAbsent.mockReturnValue({ action: 'failed', filePath: 'some/file' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('skips generate in dry-run mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockWriteIfAbsent.mockReturnValue({ action: 'dry-run', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await syncLabelsInitCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes force to writeIfAbsent', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteIfAbsent.mockReturnValue({ action: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun: false, force: true });

    expect(mockWriteIfAbsent).toHaveBeenCalledWith(expect.any(String), expect.any(String), false, true);
  });

  it('scaffolds workflow and config files', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockGenerateCommand.mockResolvedValue(0);
    mockWriteIfAbsent.mockReturnValue({ action: 'created', filePath: '' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await syncLabelsInitCommand({ dryRun: false, force: false });

    expect(mockWriteIfAbsent).toHaveBeenCalledWith(
      '.github/workflows/sync-labels.yaml',
      expect.any(String),
      false,
      false,
    );
    expect(mockWriteIfAbsent).toHaveBeenCalledWith('.config/sync-labels.config.ts', expect.any(String), false, false);
  });
});

describe(buildScopeLabels, () => {
  it('generates scope labels from workspace paths', () => {
    const result = buildScopeLabels(['packages/core', 'packages/utils']);

    expect(result).toEqual([
      { name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' },
      { name: 'scope:core', color: '00ff96', description: 'core package' },
      { name: 'scope:utils', color: '00ff96', description: 'utils package' },
    ]);
  });

  it('always includes scope:root', () => {
    const result = buildScopeLabels([]);

    expect(result).toEqual([{ name: 'scope:root', color: '00ff96', description: 'Monorepo root configuration' }]);
  });

  it('extracts basename from nested paths', () => {
    const result = buildScopeLabels(['libs/shared/core']);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ name: 'scope:core', color: '00ff96', description: 'core package' });
  });
});
