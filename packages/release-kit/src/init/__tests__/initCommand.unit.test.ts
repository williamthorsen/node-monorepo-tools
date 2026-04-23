import { afterEach, describe, expect, it, vi } from 'vitest';

const mockIsGitRepo = vi.hoisted(() => vi.fn());
const mockHasPackageJson = vi.hoisted(() => vi.fn());
const mockUsesPnpm = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());
const mockScaffoldFiles = vi.hoisted(() => vi.fn());
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

vi.mock(import('../scaffold.ts'), () => ({
  scaffoldFiles: mockScaffoldFiles,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  printError: mockPrintError,
  printSkip: mockPrintSkip,
  printStep: mockPrintStep,
  printSuccess: mockPrintSuccess,
  reportWriteResult: mockReportWriteResult,
}));

import { initCommand } from '../initCommand.ts';

/** Configure all eligibility checks to pass and repo type to single-package. */
function setupPassingChecks(): void {
  mockIsGitRepo.mockReturnValue({ ok: true });
  mockHasPackageJson.mockReturnValue({ ok: true });
  mockUsesPnpm.mockReturnValue({ ok: true });
  mockDetectRepoType.mockReturnValue('single-package');
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
    mockPrintError.mockReset();
    mockPrintSkip.mockReset();
    mockPrintStep.mockReset();
    mockPrintSuccess.mockReset();
    mockReportWriteResult.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 0 on success', () => {
    setupPassingChecks();

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(0);
    expect(mockScaffoldFiles).toHaveBeenCalledOnce();
  });

  it('returns 1 when eligibility check fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when an eligibility check throws', () => {
    mockIsGitRepo.mockImplementation(() => {
      throw new Error('unexpected filesystem error');
    });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('unexpected filesystem error'));
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when detectRepoType throws', () => {
    setupPassingChecks();
    mockDetectRepoType.mockImplementation(() => {
      throw new Error('Cannot read package.json');
    });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Cannot read package.json'));
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles throws', () => {
    setupPassingChecks();
    mockScaffoldFiles.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied'));
  });

  it('passes force as overwrite to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: true, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }));
  });

  it('passes withConfig to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: false, force: false, withConfig: true });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ withConfig: true }));
  });

  it('passes dryRun to scaffoldFiles', () => {
    setupPassingChecks();

    initCommand({ dryRun: true, force: false, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('includes provenance and trusted publisher hints in next steps', () => {
    setupPassingChecks();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    initCommand({ dryRun: false, force: false, withConfig: false });

    const allOutput = spy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(allOutput).toContain('provenance: true');
    expect(allOutput).toContain('trusted publisher');
  });

  it('prints dry-run banner when dryRun is true', () => {
    setupPassingChecks();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    initCommand({ dryRun: true, force: false, withConfig: false });

    expect(spy).toHaveBeenCalledWith('[dry-run mode]');
  });

  it('passes detected repoType to scaffoldFiles', () => {
    setupPassingChecks();
    mockDetectRepoType.mockReturnValue('monorepo');

    initCommand({ dryRun: false, force: false, withConfig: false });

    expect(mockScaffoldFiles).toHaveBeenCalledWith(expect.objectContaining({ repoType: 'monorepo' }));
  });

  it('returns 1 when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: false, message: 'No package.json found' });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('returns 1 when usesPnpm fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: true });
    mockUsesPnpm.mockReturnValue({ ok: false, message: 'pnpm not detected' });

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

    expect(exitCode).toBe(1);
    expect(mockScaffoldFiles).not.toHaveBeenCalled();
  });

  it('does not call hasPackageJson or usesPnpm when isGitRepo fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: false, message: 'Not a git repo' });

    initCommand({ dryRun: false, force: false, withConfig: false });

    expect(mockHasPackageJson).not.toHaveBeenCalled();
    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('does not call usesPnpm when hasPackageJson fails', () => {
    mockIsGitRepo.mockReturnValue({ ok: true });
    mockHasPackageJson.mockReturnValue({ ok: false, message: 'No package.json found' });

    initCommand({ dryRun: false, force: false, withConfig: false });

    expect(mockUsesPnpm).not.toHaveBeenCalled();
  });

  it('returns 1 when scaffoldFiles returns a failed result', () => {
    setupPassingChecks();
    mockScaffoldFiles.mockReturnValue([{ filePath: '.github/workflows/release.yaml', outcome: 'failed' }]);

    const exitCode = initCommand({ dryRun: false, force: false, withConfig: false });

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

    initCommand({ dryRun, force: false, withConfig: false });

    expect(mockReportWriteResult).toHaveBeenCalledWith(result, dryRun);
  });
});
