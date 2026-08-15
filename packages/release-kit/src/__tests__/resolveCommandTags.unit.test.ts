import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../discoverWorkspaces.ts'), () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../resolveReleaseTags.ts'), () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

import { resolveCommandTags } from '../resolveCommandTags.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import type { WorkspaceConfig } from '../types.ts';

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
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/cli', 'packages/release-kit']);
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
    throwOnProcessExit();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('returns all resolved tags when no filter is provided', async () => {
    const result = await resolveCommandTags(undefined);

    expect(result).toStrictEqual(TAGS);
  });

  it('passes resolved workspaces to resolveReleaseTags in monorepo mode', async () => {
    await resolveCommandTags(undefined);

    expect(mockResolveReleaseTags).toHaveBeenCalledWith({
      workspaces: [
        makeWorkspace('core', 'nmr-core-v', 'packages/core'),
        makeWorkspace('cli', 'cli-v', 'packages/cli'),
        makeWorkspace('release-kit', 'release-kit-v', 'packages/release-kit'),
      ],
    });
  });

  it('derives the single workspace config and passes it to resolveReleaseTags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    const single = makeWorkspace('root', 'v', '.');
    mockDeriveWorkspaceConfig.mockReset();
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      if (workspacePath === '.') return single;
      throw new Error(`Unexpected workspace path: ${workspacePath}`);
    });

    await resolveCommandTags(undefined);

    expect(mockDeriveWorkspaceConfig).toHaveBeenCalledWith('.');
    expect(mockResolveReleaseTags).toHaveBeenCalledWith({ singleWorkspace: single });
  });

  it('returns only the filtered tag when a single-tag filter is provided', async () => {
    const result = await resolveCommandTags(['nmr-core-v1.3.0']);

    expect(result).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('returns only the filtered subset when a multi-tag filter is provided', async () => {
    const result = await resolveCommandTags(['nmr-core-v1.3.0', 'release-kit-v2.1.0']);

    expect(result).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);
  });

  it('exits with code 1 when the first tag in the filter is unknown', async () => {
    const error = await captureError(ProcessExitError, () => resolveCommandTags(['missing-v9.9.9', 'nmr-core-v1.3.0']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0\n',
    );
  });

  it('exits with code 1 when the second tag in the filter is unknown', async () => {
    const error = await captureError(ProcessExitError, () => resolveCommandTags(['nmr-core-v1.3.0', 'missing-v9.9.9']));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0\n',
    );
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: No release tags found on HEAD. Create tags with `release-kit tag` first.\n',
    );
  });

  it('exits with code 1 when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockRejectedValue(new Error('workspace read failure'));

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Failed to discover workspaces: workspace read failure\n');
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when deriveWorkspaceConfig() throws for a missing package name', async () => {
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      throw new Error(`${workspacePath}/package.json is missing a 'name' field (required for tag derivation).`);
    });

    const error = await captureError(ProcessExitError, () => resolveCommandTags(undefined));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      "Error: Failed to resolve workspaces: packages/core/package.json is missing a 'name' field (required for tag derivation).\n",
    );
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('returns unpublishable tags alongside publishable ones (no filtering at this layer)', async () => {
    const mixedTags: ResolvedTag[] = [
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
    ];
    mockResolveReleaseTags.mockReturnValue(mixedTags);

    const result = await resolveCommandTags(undefined);

    expect(result).toStrictEqual(mixedTags);
  });
});
