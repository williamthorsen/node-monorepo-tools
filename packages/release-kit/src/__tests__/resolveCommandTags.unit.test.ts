import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockComponent = vi.hoisted(() => vi.fn());

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../resolveReleaseTags.ts', () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock('../component.ts', () => ({
  component: mockComponent,
}));

import { resolveCommandTags } from '../resolveCommandTags.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import type { ComponentConfig } from '../types.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const TAGS: ResolvedTag[] = [
  { tag: 'node-monorepo-core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
  { tag: 'cli-v0.5.0', dir: 'cli', workspacePath: 'packages/cli' },
  { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
];

function makeComponent(dir: string, tagPrefix: string, workspacePath: string): ComponentConfig {
  return {
    dir,
    tagPrefix,
    workspacePath,
    packageFiles: [`${workspacePath}/package.json`],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}

describe(resolveCommandTags, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/cli', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue(TAGS);
    mockComponent.mockImplementation((workspacePath: string) => {
      if (workspacePath === 'packages/core') {
        return makeComponent('core', 'node-monorepo-core-v', 'packages/core');
      }
      if (workspacePath === 'packages/cli') {
        return makeComponent('cli', 'cli-v', 'packages/cli');
      }
      if (workspacePath === 'packages/release-kit') {
        return makeComponent('release-kit', 'release-kit-v', 'packages/release-kit');
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
    mockComponent.mockReset();
    vi.restoreAllMocks();
  });

  it('returns all resolved tags when no filter is provided', async () => {
    const result = await resolveCommandTags(undefined);

    expect(result).toStrictEqual(TAGS);
  });

  it('passes resolved components to resolveReleaseTags in monorepo mode', async () => {
    await resolveCommandTags(undefined);

    expect(mockResolveReleaseTags).toHaveBeenCalledWith([
      makeComponent('core', 'node-monorepo-core-v', 'packages/core'),
      makeComponent('cli', 'cli-v', 'packages/cli'),
      makeComponent('release-kit', 'release-kit-v', 'packages/release-kit'),
    ]);
  });

  it('passes undefined to resolveReleaseTags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await resolveCommandTags(undefined);

    expect(mockResolveReleaseTags).toHaveBeenCalledWith(undefined);
    expect(mockComponent).not.toHaveBeenCalled();
  });

  it('returns only the filtered tag when a single-tag filter is provided', async () => {
    const result = await resolveCommandTags(['node-monorepo-core-v1.3.0']);

    expect(result).toStrictEqual([{ tag: 'node-monorepo-core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);
  });

  it('returns only the filtered subset when a multi-tag filter is provided', async () => {
    const result = await resolveCommandTags(['node-monorepo-core-v1.3.0', 'release-kit-v2.1.0']);

    expect(result).toStrictEqual([
      { tag: 'node-monorepo-core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);
  });

  it('exits with code 1 when the first tag in the filter is unknown', async () => {
    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(['missing-v9.9.9', 'node-monorepo-core-v1.3.0']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: node-monorepo-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0',
    );
  });

  it('exits with code 1 when the second tag in the filter is unknown', async () => {
    let thrown: ExitError | undefined;
    try {
      await resolveCommandTags(['node-monorepo-core-v1.3.0', 'missing-v9.9.9']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: node-monorepo-core-v1.3.0, cli-v0.5.0, release-kit-v2.1.0',
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

  it('exits with code 1 when component() throws for a missing package name', async () => {
    mockComponent.mockImplementation((workspacePath: string) => {
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
      "Error resolving workspace components: packages/core/package.json is missing a 'name' field (required for tag derivation).",
    );
    expect(mockResolveReleaseTags).not.toHaveBeenCalled();
  });
});
