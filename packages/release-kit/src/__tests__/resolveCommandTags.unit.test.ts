import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());
const mockReadRootPackageVersion = vi.hoisted(() => vi.fn());

// Partial, so that `describeEmptyWorkspace` stays the real composer: what a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../resolveReleaseTags.ts'), () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readRootPackageVersion: mockReadRootPackageVersion,
}));

import { resolveCommandTags } from '../resolveCommandTags.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import { emptyWorkspace, resolvedPackages, singlePackage } from '../test-utils/workspaceResolutions.ts';
import type { ReleaseKitConfig, WorkspaceConfig } from '../types.ts';

const EXCLUDE_CLI: ReleaseKitConfig = { workspaces: [{ dir: 'cli', shouldExclude: true }] };
const CLI_SKIP = 'Skipping cli-v0.5.0 (packages/cli): excluded by config (shouldExclude: true).';

const TAGS: ResolvedTag[] = [
  { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
  { tag: 'cli-v0.5.0', dir: 'cli', workspacePath: 'packages/cli', isPublishable: true },
  { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
];

function makeWorkspace(dir: string, tagPrefix: string, workspacePath: string, isPublishable = true): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix,
    workspacePath,
    isPublishable,
    packageFiles: [`${workspacePath}/package.json`],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}

describe(resolveCommandTags, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/cli', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue(TAGS);
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      if (workspacePath === 'packages/core') {
        return makeWorkspace('core', 'nmr-core-v', 'packages/core');
      }
      if (workspacePath === 'packages/cli') {
        return makeWorkspace('cli', 'cli-v', 'packages/cli');
      }
      if (workspacePath === 'packages/release-kit') {
        return makeWorkspace('release-kit', 'release-kit-v', 'packages/release-kit');
      }
      throw new Error(`Unexpected workspace path: ${workspacePath}`);
    });
    mockReadRootPackageVersion.mockReturnValue({ exists: true, version: '1.0.0' });
    void throwOnProcessExit();
    void silenceConsole(['warn']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    mockReadRootPackageVersion.mockReset();
    vi.restoreAllMocks();
  });

  it('returns all resolved tags when no filter is provided', () => {
    const result = resolveCommandTags(undefined, undefined);

    expect(result).toStrictEqual(TAGS);
  });

  it('passes resolved workspaces to resolveReleaseTags in monorepo mode', () => {
    resolveCommandTags(undefined, undefined);

    expect(mockResolveReleaseTags).toHaveBeenCalledWith({
      workspaces: [
        makeWorkspace('core', 'nmr-core-v', 'packages/core'),
        makeWorkspace('cli', 'cli-v', 'packages/cli'),
        makeWorkspace('release-kit', 'release-kit-v', 'packages/release-kit'),
      ],
    });
  });

  it('derives the single workspace config and passes it to resolveReleaseTags in single-package mode', () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());
    const single = makeWorkspace('root', 'v', '.');
    mockDeriveWorkspaceConfig.mockReset();
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      if (workspacePath === '.') return single;
      throw new Error(`Unexpected workspace path: ${workspacePath}`);
    });

    resolveCommandTags(undefined, undefined);

    expect(mockDeriveWorkspaceConfig).toHaveBeenCalledWith('.');
    expect(mockResolveReleaseTags).toHaveBeenCalledWith({ singleWorkspace: single });
  });

  it('returns only the filtered tag when a single-tag filter is provided', () => {
    const result = resolveCommandTags(['nmr-core-v1.3.0'], undefined);

    expect(result).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('returns only the filtered subset when a multi-tag filter is provided', () => {
    const result = resolveCommandTags(['nmr-core-v1.3.0', 'release-kit-v2.1.0'], undefined);

    expect(result).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);
  });

  it('exits with code 1 when the first tag in the filter is unknown', async () => {
    const error = await captureError(ProcessExitError, () =>
      resolveCommandTags(['missing-v9.9.9', 'nmr-core-v1.3.0'], undefined),
    );

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0\n',
    );
  });

  it('exits with code 1 when the second tag in the filter is unknown', async () => {
    const error = await captureError(ProcessExitError, () =>
      resolveCommandTags(['nmr-core-v1.3.0', 'missing-v9.9.9'], undefined),
    );

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0\n',
    );
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined, undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: No release tags found on HEAD. Create tags with `release-kit tag` first.\n',
    );
  });

  // The defect this change repairs: a workspace resolving to nothing used to read as single-package mode and
  // release the root as one package.
  it('exits with code 1 when the workspace resolves to no package', async () => {
    mockDiscoverWorkspaces.mockReturnValue(emptyWorkspace('all-excluded'));

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined, undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks.join('')).toContain('No workspace package to tag.');
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockImplementation(() => {
      throw new Error('workspace read failure');
    });

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined, undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Failed to discover workspaces: workspace read failure\n');
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when deriveWorkspaceConfig() throws for a missing package name', async () => {
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      throw new Error(`${workspacePath}/package.json is missing a 'name' field (required for tag derivation).`);
    });

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined, undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      "Error: Failed to resolve workspaces: packages/core/package.json is missing a 'name' field (required for tag derivation).\n",
    );
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('returns unpublishable tags alongside publishable ones (no filtering at this layer)', () => {
    const mixedTags: ResolvedTag[] = [
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
    ];
    mockResolveReleaseTags.mockReturnValue(mixedTags);

    const result = resolveCommandTags(undefined, undefined);

    expect(result).toStrictEqual(mixedTags);
  });

  describe('with workspace overrides', () => {
    it('drops the tag of an excluded workspace and warns about it', () => {
      const result = resolveCommandTags(undefined, EXCLUDE_CLI);

      expect(result).toStrictEqual(TAGS.filter((t) => t.dir !== 'cli'));
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(CLI_SKIP);
    });

    it('matches tags against the retained workspaces followed by the excluded ones', () => {
      resolveCommandTags(undefined, EXCLUDE_CLI);

      expect(mockResolveReleaseTags).toHaveBeenCalledWith({
        workspaces: [
          makeWorkspace('core', 'nmr-core-v', 'packages/core'),
          makeWorkspace('release-kit', 'release-kit-v', 'packages/release-kit'),
          makeWorkspace('cli', 'cli-v', 'packages/cli'),
        ],
      });
    });

    it('skips an excluded tag named in --tags rather than rejecting it as unknown', () => {
      const result = resolveCommandTags(['cli-v0.5.0', 'nmr-core-v1.3.0'], EXCLUDE_CLI);

      expect(result).toStrictEqual([TAGS[0]]);
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(CLI_SKIP);
      expect(capture.stderrChunks.join('')).not.toContain('Unknown tag');
    });

    it('warns only about the excluded tags that --tags selects', () => {
      resolveCommandTags(['nmr-core-v1.3.0'], EXCLUDE_CLI);

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('returns an empty list when every tag on HEAD belongs to an excluded workspace', () => {
      mockResolveReleaseTags.mockReturnValue([TAGS[1]]);

      const result = resolveCommandTags(undefined, EXCLUDE_CLI);

      expect(result).toStrictEqual([]);
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(CLI_SKIP);
      expect(capture.stderrChunks.join('')).not.toContain('No release tags found on HEAD');
    });

    it('exits with code 1 when the config fails the merge validation', async () => {
      mockReadRootPackageVersion.mockReturnValue({ exists: false, version: undefined });

      const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined, { project: {} }));

      expect(error.code).toBe(1);
      expect(capture.stderrChunks.join('')).toContain('Error: Failed to resolve workspaces: ');
      expect(mockResolveReleaseTags).not.toHaveBeenCalled();
    });

    it('ignores the config in single-package mode', () => {
      mockDiscoverWorkspaces.mockReturnValue(singlePackage());
      mockDeriveWorkspaceConfig.mockReturnValue(makeWorkspace('.', 'v', '.'));
      const singleTags: ResolvedTag[] = [{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true }];
      mockResolveReleaseTags.mockReturnValue(singleTags);

      const result = resolveCommandTags(undefined, { project: {}, workspaces: [{ dir: '.', shouldExclude: true }] });

      expect(result).toStrictEqual(singleTags);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
