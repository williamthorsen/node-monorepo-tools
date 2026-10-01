import type { PathLike } from 'node:fs';

import type { ManagedFileResult, StreamStyles } from '@williamthorsen/nmr-core';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLabelsWorkflow } from '../../sync-labels/templates.ts';
import { createGithubReleaseWorkflow, publishWorkflow, releaseWorkflow } from '../templates.ts';

const mockExistsSync = vi.hoisted(() => vi.fn<(path: PathLike) => boolean>());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockIsGitRepo = vi.hoisted(() => vi.fn());
const mockHasPackageJson = vi.hoisted(() => vi.fn());
const mockUsesPnpm = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());
const mockUpdateManagedFile = vi.hoisted(() =>
  vi.fn<(filePath: string, content: string, options: { dryRun: boolean }) => ManagedFileResult>(),
);
const mockReportTemplateUpdate = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../checks.ts'), () => ({
  isGitRepo: mockIsGitRepo,
  hasPackageJson: mockHasPackageJson,
  usesPnpm: mockUsesPnpm,
}));

vi.mock(import('../detectRepoType.ts'), () => ({
  detectRepoType: mockDetectRepoType,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  printError: vi.fn(),
  printStep: vi.fn(),
  printSuccess: vi.fn(),
  reportTemplateUpdate: mockReportTemplateUpdate,
  updateManagedFile: mockUpdateManagedFile,
}));

import { updateTemplatesCommand } from '../updateTemplatesCommand.ts';

const STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };

describe(updateTemplatesCommand, () => {
  beforeEach(() => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: true });
    mockUsesPnpm.mockReturnValue({ ok: true });
    mockDetectRepoType.mockReturnValue('monorepo');
    mockExistsSync.mockReturnValue(false);
    mockUpdateManagedFile.mockImplementation((filePath) => ({ filePath, outcome: 'up-to-date' }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates the three core workflows from the templates for the detected repo type', () => {
    using _silent = silenceConsole(['info']);

    const exitCode = updateTemplatesCommand({ dryRun: false, styles: STYLES });

    expect(exitCode).toBe(0);
    expect(listUpdates()).toStrictEqual([
      ['.github/workflows/create-github-release.yaml', createGithubReleaseWorkflow('monorepo')],
      ['.github/workflows/publish.yaml', publishWorkflow('monorepo')],
      ['.github/workflows/release.yaml', releaseWorkflow('monorepo')],
    ]);
    expect(mockReportTemplateUpdate).toHaveBeenCalledTimes(3);
  });

  it('refreshes sync-labels.yaml when it exists', () => {
    using _silent = silenceConsole(['info']);
    mockExistsSync.mockImplementation((path) => path === '.github/workflows/sync-labels.yaml');

    updateTemplatesCommand({ dryRun: false, styles: STYLES });

    expect(listUpdates()).toContainEqual(['.github/workflows/sync-labels.yaml', syncLabelsWorkflow()]);
  });

  it('does not create sync-labels.yaml when it is missing', () => {
    using _silent = silenceConsole(['info']);

    updateTemplatesCommand({ dryRun: false, styles: STYLES });

    expect(listUpdates().map(([filePath]) => filePath)).not.toContain('.github/workflows/sync-labels.yaml');
  });

  it('keeps provenance off when the existing publish workflow does not set it', () => {
    using _silent = silenceConsole(['info']);
    mockExistsSync.mockImplementation((path) => path === '.github/workflows/publish.yaml');
    mockReadFileSync.mockReturnValue(publishWorkflow('monorepo', { provenance: false }));

    updateTemplatesCommand({ dryRun: false, styles: STYLES });

    expect(listUpdates()).toContainEqual([
      '.github/workflows/publish.yaml',
      publishWorkflow('monorepo', { provenance: false }),
    ]);
  });

  it('touches only workflow files', () => {
    using _silent = silenceConsole(['info']);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    updateTemplatesCommand({ dryRun: false, styles: STYLES });

    const touched = [
      ...listUpdates().map(([filePath]) => filePath),
      ...mockReadFileSync.mock.calls.map((call) => String(call[0])),
    ];
    expect(touched.every((filePath) => filePath.startsWith('.github/workflows/'))).toBe(true);
  });

  it('passes dryRun through to every update', () => {
    using _silent = silenceConsole(['info']);

    updateTemplatesCommand({ dryRun: true, styles: STYLES });

    for (const call of mockUpdateManagedFile.mock.calls) {
      expect(call[2]).toStrictEqual({ dryRun: true });
    }
    expect(mockReportTemplateUpdate).toHaveBeenCalledWith(expect.anything(), true, STYLES);
  });

  it('returns 1 when any update fails', () => {
    using _silent = silenceConsole(['info']);
    mockUpdateManagedFile.mockImplementation((filePath) => ({
      filePath,
      outcome: filePath.endsWith('release.yaml') ? 'failed' : 'updated',
    }));

    expect(updateTemplatesCommand({ dryRun: false, styles: STYLES })).toBe(1);
  });

  it('returns 1 without updating anything when an eligibility check fails', () => {
    using _silent = silenceConsole(['info']);
    mockUsesPnpm.mockReturnValue({ ok: false, message: 'pnpm not detected' });

    expect(updateTemplatesCommand({ dryRun: false, styles: STYLES })).toBe(1);
    expect(mockUpdateManagedFile).not.toHaveBeenCalled();
  });
});

// region | Helpers
/** Lists the path and content of every `updateManagedFile` call. */
function listUpdates(): Array<[string, string]> {
  return mockUpdateManagedFile.mock.calls.map(([filePath, content]) => [filePath, content]);
}
// endregion | Helpers
