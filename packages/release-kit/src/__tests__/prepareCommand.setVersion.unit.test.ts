import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareCommandDefaults,
  mockAssertCleanWorkingTree,
  mockDiscoverWorkspaces,
  mockExecSync,
  mockExistsSync,
  mockLoadConfig,
  mockLookUpNpmPackage,
  mockReadFileSync,
  mockReleasePrepareTargets,
  mockWriteFileWithCheck,
  resetPrepareCommandMocks,
} = await vi.hoisted(() => import('../test-utils/prepareCommandMocks.ts'));

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
  const actual = await importOriginal<typeof import('../loadConfig.ts')>();
  return {
    ...actual,
    loadConfig: mockLoadConfig,
  };
});

vi.mock(import('../releasePrepareTargets.ts'), () => ({
  releasePrepareTargets: mockReleasePrepareTargets,
}));

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import { prepareCommand } from '../prepareCommand.ts';
import { singlePackage } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(prepareCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    applyPrepareCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    resetPrepareCommandMocks();
    vi.restoreAllMocks();
  });

  it('passes each --set-version entry to the orchestrator, keyed by workspace, without --only', async () => {
    await prepareCommand(
      ['--set-version=arrays@1.0.0,strings@2.0.0', '--force', '--bump=minor'],
      RICH_STYLES,
      process.cwd(),
    );

    expect(mockReleasePrepareTargets).toHaveBeenCalledWith(expect.any(Object), {
      force: true,
      bumpOverride: 'minor',
      setVersions: new Map([
        ['arrays', '1.0.0'],
        ['strings', '2.0.0'],
      ]),
    });
  });

  it.each([
    ['a bare version', '1.0.0'],
    ['a pre-release suffix', 'arrays@1.0.0-alpha'],
    ['a non-canonical version', 'arrays@1.0'],
    ['an empty version', 'arrays@'],
    ['an empty workspace name', '@1.0.0'],
    ['an empty entry', 'arrays@1.0.0,'],
  ])('rejects %s in monorepo --set-version, naming the expected form', async (_label, value) => {
    await expect(prepareCommand([`--set-version=${value}`], RICH_STYLES, process.cwd())).rejects.toThrow(
      ProcessExitError,
    );
    expect(capture.stderr).toContain('Invalid --set-version entry');
    expect(capture.stderr).toContain('<target>@N.N.N');
    expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
  });

  it('rejects an unknown workspace in --set-version', async () => {
    await expect(prepareCommand(['--set-version=nonexistent@1.0.0'], RICH_STYLES, process.cwd())).rejects.toThrow(
      ProcessExitError,
    );
    expect(capture.stderr).toContain('Unknown release target "nonexistent" in --set-version');
    expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
  });

  it('rejects a workspace that --set-version names twice', async () => {
    await expect(
      prepareCommand(['--set-version=arrays@1.0.0,arrays@2.0.0'], RICH_STYLES, process.cwd()),
    ).rejects.toThrow(ProcessExitError);
    expect(capture.stderr).toContain('names target "arrays" more than once');
    expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
  });

  it('rejects a version that is not canonical in single-package --set-version', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await expect(prepareCommand(['--set-version=1.0'], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(capture.stderr).toContain('Invalid --set-version value "1.0"');
    expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
  });

  it('passes the --set-version version under the root target in single-package mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await prepareCommand(['--set-version=1.2.3'], RICH_STYLES, process.cwd());

    expect(mockReleasePrepareTargets).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ setVersions: new Map([['.', '1.2.3']]) }),
    );
  });

  it('forwards withReleaseNotes in monorepo mode when --with-release-notes is set', async () => {
    await prepareCommand(['--with-release-notes'], RICH_STYLES, process.cwd());

    expect(mockReleasePrepareTargets).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ withReleaseNotes: true }),
    );
  });

  it('forwards withReleaseNotes in single-package mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await prepareCommand(['--with-release-notes'], RICH_STYLES, process.cwd());

    expect(mockReleasePrepareTargets).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ withReleaseNotes: true }),
    );
  });

  it('omits withReleaseNotes from options when the flag is not set', async () => {
    await prepareCommand([], RICH_STYLES, process.cwd());

    const callArgs = mockReleasePrepareTargets.mock.calls[0]?.[1];
    expect(callArgs).not.toHaveProperty('withReleaseNotes');
  });

  describe('--only with a releases composite', () => {
    beforeEach(() => {
      mockLoadConfig.mockResolvedValue({ releases: { suite: { includes: ['arrays'] } } });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'packages/arrays/package.json') {
          return JSON.stringify({ name: '@scope/arrays' });
        }
        if (filePath === 'packages/strings/package.json') {
          return JSON.stringify({ name: '@scope/strings' });
        }
        return JSON.stringify({ name: 'root', version: '0.9.0' });
      });
    });

    it('accepts the composite name and passes it through to the orchestrator', async () => {
      await prepareCommand(['--only=suite'], RICH_STYLES, process.cwd());

      expect(mockReleasePrepareTargets).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ only: ['suite'] }),
      );
    });

    it('rejects an unknown name, listing every selectable target', async () => {
      await expect(prepareCommand(['--only=nonexistent'], RICH_STYLES, process.cwd())).rejects.toThrow(
        ProcessExitError,
      );
      expect(capture.stderr).toContain('Unknown release target "nonexistent". Known targets: arrays, strings, suite');
    });
  });

  describe('--only and --set-version interactions with project block', () => {
    beforeEach(() => {
      // Configure the mocks so that the project block is loaded and the root package.json is valid.
      mockLoadConfig.mockResolvedValue({ project: {} });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'packages/arrays/package.json') {
          return JSON.stringify({ name: '@scope/arrays' });
        }
        if (filePath === 'packages/strings/package.json') {
          return JSON.stringify({ name: '@scope/strings' });
        }
        // Root package.json for the project block prerequisite check.
        return JSON.stringify({ name: 'root', version: '0.9.0' });
      });
    });

    it('accepts --only and passes the narrowing through to the orchestrator', async () => {
      await prepareCommand(['--only=arrays'], RICH_STYLES, process.cwd());

      expect(mockReleasePrepareTargets).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ only: ['arrays'] }),
      );
    });

    it('omits the narrowing from the orchestrator options when --only is absent', async () => {
      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockReleasePrepareTargets.mock.calls[0]?.[1]).not.toHaveProperty('only');
    });

    it('still rejects --only with an unknown workspace name', async () => {
      await expect(prepareCommand(['--only=nonexistent'], RICH_STYLES, process.cwd())).rejects.toThrow(
        ProcessExitError,
      );
      expect(capture.stderr).toContain('nonexistent');
      expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
    });

    it('runs normally without --only when project is configured', async () => {
      await prepareCommand([], RICH_STYLES, process.cwd());
      expect(mockReleasePrepareTargets).toHaveBeenCalled();
    });

    it('rejects --set-version with the project-aware error', async () => {
      await expect(prepareCommand(['--set-version=arrays@1.2.3'], RICH_STYLES, process.cwd())).rejects.toThrow(
        ProcessExitError,
      );
      expect(capture.stderr).toContain('--set-version cannot be combined with a project release');
      expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
    });

    it('rejects --set-version + --only with the project-aware error', async () => {
      await expect(
        prepareCommand(['--set-version=arrays@1.2.3', '--only=arrays'], RICH_STYLES, process.cwd()),
      ).rejects.toThrow(ProcessExitError);
      expect(capture.stderr).toContain('--set-version cannot be combined with a project release');
      expect(mockReleasePrepareTargets).not.toHaveBeenCalled();
    });
  });
});
