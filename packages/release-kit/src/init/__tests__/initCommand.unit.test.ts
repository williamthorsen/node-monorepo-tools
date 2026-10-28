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
function stubPassingChecks(): void {
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
    stubPassingChecks();

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(0);
    expect(mockScaffoldFiles).toHaveBeenCalledTimes(1);
  });

  it('passes the stdout style to every printSuccess call', () => {
    stubPassingChecks();

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockPrintSuccess.mock.calls).toStrictEqual([
      ['Git repository detected', 'rich'],
      ['package.json found', 'rich'],
      ['pnpm detected', 'rich'],
      ['Detected: single-package', 'rich'],
    ]);
  });

  it('returns 1 when eligibility check fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith('Not a git repo', 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when an eligibility check throws', () => {
    mockIsGitRepo.mockImplementation(() => {
      throw new Error('unexpected filesystem error');
    });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('unexpected filesystem error'), 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when detectRepoType throws', () => {
    stubPassingChecks();
    mockDetectRepoType.mockImplementation(() => {
      throw new Error('Cannot read package.json');
    });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Cannot read package.json'), 'plain');
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles throws', () => {
    stubPassingChecks();
    mockScaffoldFiles.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied'), 'plain');
  });

  it('passes shouldForce as shouldOverwrite to scaffoldFiles', () => {
    stubPassingChecks();

    initCommand({ isDryRun: false, shouldForce: true, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ shouldOverwrite: true }));
  });

  it('passes shouldScaffoldConfig to scaffoldFiles', () => {
    stubPassingChecks();

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: true });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ shouldScaffoldConfig: true }));
  });

  it('passes isDryRun to scaffoldFiles', () => {
    stubPassingChecks();

    initCommand({ isDryRun: true, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ isDryRun: true }));
  });

  it('includes provenance and trusted publisher hints in next steps', () => {
    stubPassingChecks();
    using silencedConsole = silenceConsole(['info']);

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    const allOutput = listConsoleLines(silencedConsole.info).join('\n');
    expect(allOutput).toContain('If this is a private repo, remove provenance: true');
    expect(allOutput).toContain('trusted publisher');
  });

  it('passes publishable to scaffoldFiles', () => {
    stubPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);

    initCommand({ isDryRun: false, shouldForce: true, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ publishable: false }));
  });

  it('reports each skipped publishing workflow when every package is private', () => {
    stubPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockPrintSkip.mock.calls).toStrictEqual([
      ['Skipping .github/workflows/create-github-release.yaml: every package is private', 'rich'],
      ['Skipping .github/workflows/publish.yaml: every package is private', 'rich'],
    ]);
  });

  it('does not report a skip when a package is publishable', () => {
    stubPassingChecks();

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockPrintSkip).not.toHaveBeenCalled();
  });

  it('omits the publishing steps from next steps when every package is private', () => {
    stubPassingChecks();
    mockHasPublishablePackage.mockReturnValue(false);
    using silencedConsole = silenceConsole(['info']);

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(listConsoleLines(silencedConsole.info).join('\n')).toContain(
      [
        '  1. (Optional) Run again with --with-config to scaffold config files.',
        '  2. Test by running: npx @williamthorsen/release-kit prepare --dry-run',
        '  3. Commit the generated files.',
      ].join('\n'),
    );
    expect(listConsoleLines(silencedConsole.info).join('\n')).not.toContain('provenance');
    expect(listConsoleLines(silencedConsole.info).join('\n')).not.toContain('trusted publisher');
  });

  it('prints dry-run banner when isDryRun is true', () => {
    stubPassingChecks();
    using silencedConsole = silenceConsole(['info']);

    initCommand({ isDryRun: true, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(silencedConsole.info).toHaveBeenCalledWith('[dry-run mode]');
  });

  it('passes detected repoType to scaffoldFiles', () => {
    stubPassingChecks();
    mockDetectRepoType.mockReturnValue('monorepo');

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ repoType: 'monorepo' }));
  });

  it('returns 1 when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({
      ok: false,
      message: 'The current directory does not contain a package.json. Run `npm init` or `pnpm init` first.',
    });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when usesPnpm fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: true });
    mockUsesPnpm.mockReturnValue({ ok: false, message: 'pnpm not detected' });

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('does not call hasPackageJson or usesPnpm when isGitRepo fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockHasPackageJson).not.toHaveBeenCalled();
    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('does not call usesPnpm when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({
      ok: false,
      message: 'The current directory does not contain a package.json. Run `npm init` or `pnpm init` first.',
    });

    initCommand({ isDryRun: false, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles returns a failed result', () => {
    stubPassingChecks();
    mockScaffoldFiles.mockReturnValue([{ filePath: '.github/workflows/release.yaml', outcome: 'failed' }]);

    const exitCode = initCommand({
      isDryRun: false,
      shouldForce: false,
      styles: SPLIT_STYLES,
      shouldScaffoldConfig: false,
    });

    expect(exitCode).toBe(1);
  });

  it.each([
    { outcome: 'created', isDryRun: false },
    { outcome: 'overwritten', isDryRun: false },
    { outcome: 'overwritten', isDryRun: true },
    { outcome: 'up-to-date', isDryRun: false },
    { outcome: 'skipped', isDryRun: false },
    { outcome: 'failed', isDryRun: false },
  ])('calls reportWriteResult for $outcome outcome (isDryRun=$isDryRun)', ({ outcome, isDryRun }) => {
    stubPassingChecks();
    const result = { filePath: '.github/workflows/release.yaml', outcome };
    mockScaffoldFiles.mockReturnValue([result]);

    initCommand({ isDryRun, shouldForce: false, styles: SPLIT_STYLES, shouldScaffoldConfig: false });

    expect(mockReportWriteResult).toHaveBeenCalledWith(result, isDryRun, SPLIT_STYLES);
  });
});
