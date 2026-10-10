import type { StreamStyles } from '@williamthorsen/nmr-core';
import { listConsoleLines, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockIsGitRepo = vi.hoisted(() => vi.fn());
const mockHasPackageJson = vi.hoisted(() => vi.fn());
const mockUsesPnpm = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());
const mockScaffoldFiles = vi.hoisted(() => vi.fn());
const mockHasPublishablePackage = vi.hoisted(() => vi.fn());
const mockPrintError = vi.hoisted(() => vi.fn());
const mockPrintSkip = vi.hoisted(() => vi.fn());
const mockPrintStep = vi.hoisted(() => vi.fn());
const mockPrintSuccess = vi.hoisted(() => vi.fn());
const mockReportWriteResult = vi.hoisted(() => vi.fn());

vi.mock(import('../checks.ts'), () => ({
  isGitRepo: mockIsGitRepo,
  hasPackageJson: mockHasPackageJson,
  usesPnpm: mockUsesPnpm,
}));

vi.mock(import('../detectRepoType.ts'), () => ({
  detectRepoType: mockDetectRepoType,
}));

vi.mock(import('../scaffold.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  scaffoldFiles: mockScaffoldFiles,
}));

vi.mock(import('../hasPublishablePackage.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasPublishablePackage: mockHasPublishablePackage,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  printError: mockPrintError,
  printSkip: mockPrintSkip,
  printStep: mockPrintStep,
  printSuccess: mockPrintSuccess,
  reportWriteResult: mockReportWriteResult,
}));

import { initCommand } from '../initCommand.ts';

// The streams differ so that a helper given the other stream's style fails its assertion.
const SPLIT_STYLES: StreamStyles = { stderr: 'plain', stdout: 'rich' };

/** Configures every eligibility check to pass and the repo type as single-package. */
function setupPassingChecks(): void {
  mockIsGitRepo.mockReturnValue({ ok: true });
  mockHasPackageJson.mockReturnValue({ ok: true });
  mockUsesPnpm.mockReturnValue({ ok: true });
  mockDetectRepoType.mockReturnValue('single-package');
  mockHasPublishablePackage.mockReturnValue(true);
  mockScaffoldFiles.mockReturnValue([
    { filePath: '.github/workflows/release.yaml', outcome: 'created' },
    { filePath: '.github/workflows/publish.yaml', outcome: 'created' },
  ]);
}

describe(initCommand, () => {
  afterEach(() => {
    mockIsGitRepo.mockReset();
    mockHasPackageJson.mockReset();
    mockUsesPnpm.mockReset();
    mockDetectRepoType.mockReset();
    mockScaffoldFiles.mockReset();
    mockHasPublishablePackage.mockReset();
    mockPrintError.mockReset();
    mockPrintSkip.mockReset();
    mockPrintStep.mockReset();
    mockPrintSuccess.mockReset();
    mockReportWriteResult.mockReset();
  });

  it('returns 0 on success', () => {
    setupPassingChecks();

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(0);
    expect(mockScaffoldFiles).toHaveBeenCalledTimes(1);
  });

  it('passes the stdout style to every printSuccess call', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockPrintSuccess.mock.calls).toStrictEqual([
      ['Git repository detected', 'rich'],
      ['package.json found', 'rich'],
      ['pnpm detected', 'rich'],
      ['Detected: single-package', 'rich'],
    ]);
  });

  it('returns 1 when eligibility check fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith('Not a git repo', 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when an eligibility check throws', () => {
    mockIsGitRepo.mockImplementation(() => {
      throw new Error('unexpected filesystem error');
    });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('unexpected filesystem error'), 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when detectRepoType throws', () => {
    setupPassingChecks();
    mockDetectRepoType.mockImplementation(() => {
      throw new Error('Cannot read package.json');
    });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Cannot read package.json'), 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles throws', () => {
    setupPassingChecks();
    mockScaffoldFiles.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied'), 'plain');
  });

  it('passes force as overwrite to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: true, styles: SPLIT_STYLES, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }));
  });

  it('passes withConfig to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: true });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ withConfig: true }));
  });

  it('passes dryRun to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: true, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('includes provenance and trusted publisher hints in next steps', () => {
    setupPassingChecks();
    using silent = silenceConsole(['info']);

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    const allOutput = listConsoleLines(silent.info).join('\n');
    expect(allOutput).toContain('If this is a private repo, remove provenance: true');
    expect(allOutput).toContain('trusted publisher');
  });

  it('passes publishable to scaffoldFiles', () => {
    setupPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);

    initCommand({ dryRun: false, force: true, styles: SPLIT_STYLES, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ publishable: false }));
  });

  it('reports each skipped publishing workflow when every package is private', () => {
    setupPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockPrintSkip.mock.calls).toStrictEqual([
      ['Skipping .github/workflows/create-github-release.yaml: every package is private', 'rich'],
      ['Skipping .github/workflows/publish.yaml: every package is private', 'rich'],
    ]);
  });

  it('does not report a skip when a package is publishable', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockPrintSkip).not.toHaveBeenCalled();
  });

  it('omits the publishing steps from next steps when every package is private', () => {
    setupPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);
    using silent = silenceConsole(['info']);

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(listConsoleLines(silent.info).join('\n')).toContain(
      [
        '  1. (Optional) Run again with --with-config to scaffold config files.',
        '  2. Test by running: npx @williamthorsen/release-kit prepare --dry-run',
        '  3. Commit the generated files.',
      ].join('\n'),
    );
    expect(listConsoleLines(silent.info).join('\n')).not.toContain('provenance');
    expect(listConsoleLines(silent.info).join('\n')).not.toContain('trusted publisher');
  });

  it('prints dry-run banner when dryRun is true', () => {
    setupPassingChecks();
    using silent = silenceConsole(['info']);

    initCommand({ dryRun: true, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(silent.info).toHaveBeenCalledWith('[dry-run mode]');
  });

  it('passes detected repoType to scaffoldFiles', () => {
    setupPassingChecks();
    mockDetectRepoType.mockReturnValue('monorepo');

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ repoType: 'monorepo' }));
  });

  it('returns 1 when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({
      ok: false,
      message: 'The current directory does not contain a package.json. Run `npm init` or `pnpm init` first.',
    });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when usesPnpm fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: true });
    mockUsesPnpm.mockReturnValue({ ok: false, message: 'pnpm not detected' });

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('does not call hasPackageJson or usesPnpm when isGitRepo fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockHasPackageJson).not.toHaveBeenCalled();
    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('does not call usesPnpm when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({
      ok: false,
      message: 'The current directory does not contain a package.json. Run `npm init` or `pnpm init` first.',
    });

    initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles returns a failed result', () => {
    setupPassingChecks();
    mockScaffoldFiles.mockReturnValue([{ filePath: '.github/workflows/release.yaml', outcome: 'failed' }]);

    const exitCode = initCommand({ dryRun: false, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(exitCode).toBe(1);
  });

  it.each([
    { outcome: 'created', dryRun: false },
    { outcome: 'overwritten', dryRun: false },
    { outcome: 'overwritten', dryRun: true },
    { outcome: 'up-to-date', dryRun: false },
    { outcome: 'skipped', dryRun: false },
    { outcome: 'failed', dryRun: false },
  ])('calls reportWriteResult for $outcome outcome (dryRun=$dryRun)', ({ outcome, dryRun }) => {
    setupPassingChecks();
    const result = { filePath: '.github/workflows/release.yaml', outcome };
    mockScaffoldFiles.mockReturnValue([result]);

    initCommand({ dryRun, force: false, styles: SPLIT_STYLES, withConfig: false });

    expect(mockReportWriteResult).toHaveBeenCalledWith(result, dryRun, SPLIT_STYLES);
  });
});
