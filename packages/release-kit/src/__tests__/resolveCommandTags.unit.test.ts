import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../resolveReleaseTags.ts', () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock('../deriveWorkspaceConfig.ts', () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

import { resolveCommandTags } from '../resolveCommandTags.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import type { WorkspaceConfig } from '../types.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

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
  beforeEach(() => {
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
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
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
    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(['missing-v9.9.9', 'nmr-core-v1.3.0']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0',
    );
  });

  it('exits with code 1 when the second tag in the filter is unknown', async () => {
    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(['nmr-core-v1.3.0', 'missing-v9.9.9']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: nmr-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0',
    );
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(undefined);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: No release tags found on HEAD. Create tags with `release-kit tag` first.',
    );
  });

  it('exits with code 1 when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockRejectedValue(new Error('workspace read failure'));

    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(undefined);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error discovering workspaces: workspace read failure');
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });

  it('exits with code 1 when deriveWorkspaceConfig() throws for a missing package name', async () => {
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      throw new Error(`${workspacePath}/package.json is missing a 'name' field (required for tag derivation).`);
    });

    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(undefined);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "Error resolving workspaces: packages/core/package.json is missing a 'name' field (required for tag derivation).",
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
