import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareCommandDefaults,
  makePrepareResult,
  mockAssertCleanWorkingTree,
  mockDiscoverWorkspaces,
  mockExecSync,
  mockExistsSync,
  mockLoadConfig,
  mockLookUpNpmPackage,
  mockReadFileSync,
  mockPrepareReleaseTargets,
  mockWriteFileWithCheck,
  resetPrepareCommandMocks,
} = await vi.hoisted(() => import('../test-utils/prepareCommandMocks.ts'));

const mockAssertTarballsComplete = vi.hoisted(() => vi.fn());

// Packing from a clean checkout needs an installable repo, which these fixtures are not; the check is covered on its own.
vi.mock(import('../assertTarballsComplete.ts'), () => ({
  assertTarballsComplete: mockAssertTarballsComplete,
}));

vi.mock(import('node:child_process'), () => ({
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../npmRegistry.ts'), () => ({
  lookUpNpmPackage: mockLookUpNpmPackage,
}));

vi.mock(import('../assertCleanWorkingTree.ts'), () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const actualModule = await importOriginal<typeof import('../loadConfig.ts')>();
  return {
    ...actualModule,
    loadConfig: mockLoadConfig,
  };
});

vi.mock(import('../prepareReleaseTargets.ts'), () => ({
  prepareReleaseTargets: mockPrepareReleaseTargets,
}));

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => {
  const actualModule = await importOriginal();
  return {
    ...actualModule,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import { prepareCommand } from '../prepareCommand.ts';
import { makeSinglePackage } from '../test-utils/workspaceResolutions.ts';
import type { ReleasedPackageResult, SkippedPackageResult } from '../types.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(prepareCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyPrepareCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetPrepareCommandMocks();
    mockAssertTarballsComplete.mockReset();
    vi.restoreAllMocks();
  });

  describe('npm check', () => {
    it('looks up only the workspaces that the plan releases', async () => {
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays'), makeSkippedResult('strings')],
          tags: ['arrays-v1.0.0'],
        }),
      );

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).toHaveBeenCalledTimes(1);
      expect(mockLookUpNpmPackage).toHaveBeenCalledWith('@scope/arrays', undefined);
    });

    it('refuses without writing any file when npm does not list a released package', async () => {
      mockLookUpNpmPackage.mockReturnValue({ status: 'unpublished' });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays')],
          tags: ['arrays-v1.0.0'],
          writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
        }),
      );

      await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
      expect(stdioCapture.stderrChunks.join('')).toContain(
        '@scope/arrays: run "npm publish --access public" from packages/arrays',
      );
      expect(stdioCapture.stderrChunks).toContain(
        'The command did not write any files; the working tree is unchanged.\n',
      );
    });

    it('refuses during a dry run as well', async () => {
      mockLookUpNpmPackage.mockReturnValue({
        status: 'unverifiable',
        detail: 'Cannot reach the npm registry (ENOTFOUND)',
      });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({ targets: [makeReleasedResult('arrays')], tags: ['arrays-v1.0.0'] }),
      );

      await expect(prepareCommand(['--dry-run'], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
      expect(stdioCapture.stderrChunks.join('')).toContain('@scope/arrays: Cannot reach the npm registry (ENOTFOUND)');
    });

    it('looks up the root package in a single-package release', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'package.json') {
          return JSON.stringify({ name: 'single-package' });
        }
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({ targets: [makeReleasedResult()], tags: ['v1.0.0'] }),
      );

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).toHaveBeenCalledWith('single-package', undefined);
    });

    it('does not call the registry when the plan does not release anything', async () => {
      mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ targets: [makeSkippedResult('arrays')] }));

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).not.toHaveBeenCalled();
    });
  });

  describe('tarball check', () => {
    it('checks the released workspaces with the configured development conditions', async () => {
      mockLoadConfig.mockResolvedValue({ devExportConditions: ['nmr-source'] });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays'), makeSkippedResult('strings')],
          tags: ['arrays-v1.0.0'],
        }),
      );

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockAssertTarballsComplete).toHaveBeenCalledWith(['packages/arrays'], ['nmr-source']);
    });

    it('refuses without writing any file when a tarball lacks a manifest file', async () => {
      mockAssertTarballsComplete.mockImplementation(() => {
        throw new Error('Cannot release: The tarball of every package must contain each file that its manifest names.');
      });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays')],
          tags: ['arrays-v1.0.0'],
          writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
        }),
      );

      const error = await captureError(ProcessExitError, () => prepareCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
      expect(stdioCapture.stderr).toContain('must contain each file that its manifest names');
      expect(stdioCapture.stderrChunks).toContain(
        'The command did not write any files; the working tree is unchanged.\n',
      );
    });
  });
});

// region | Helpers
/** Builds a released package result, named by workspace `dir` as in monorepo mode. */
function makeReleasedResult(name?: string): ReleasedPackageResult {
  return {
    targetId: name ?? '.',
    kind: 'package',
    status: 'released',
    ...(name !== undefined && { name }),
    commitCount: 1,
    currentVersion: '0.9.0',
    newVersion: '1.0.0',
    tag: name === undefined ? 'v1.0.0' : `${name}-v1.0.0`,
    bumpedFiles: [],
    changelogFiles: [],
  };
}

/** Builds a skipped package result. */
function makeSkippedResult(name: string): SkippedPackageResult {
  return {
    targetId: name,
    kind: 'package',
    status: 'skipped',
    name,
    commitCount: 0,
    parsedCommitCount: 0,
    skipReason: 'No commits',
  };
}
// endregion | Helpers
