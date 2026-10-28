import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPushRelease = vi.hoisted(() => vi.fn());
const mockResolveCommandTags = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../pushRelease.ts'), () => ({
  pushRelease: mockPushRelease,
}));

vi.mock(import('../resolveCommandTags.ts'), () => ({
  resolveCommandTags: mockResolveCommandTags,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadConfig: mockLoadConfig,
  readRootPackageVersion: () => ({ doesExist: true, version: '1.0.0' }),
}));

// The discovery-level mocks serve the tests that run the real `resolveCommandTags`.
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

import { pushCommand } from '../pushCommand.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import { resolvedPackages } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

const TAGS: ResolvedTag[] = [
  { tag: 'core-v1.2.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
  { tag: 'cli-v0.5.0', kind: 'package', dir: 'cli', workspacePath: 'packages/cli', isPublishable: true },
];

describe(pushCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    mockResolveCommandTags.mockReturnValue(TAGS);
    mockPushRelease.mockReturnValue([]);
    mockLoadConfig.mockResolvedValue(undefined);
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockPushRelease.mockReset();
    mockResolveCommandTags.mockReset();
    mockLoadConfig.mockReset();
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to pushRelease with default options', async () => {
    await pushCommand([], RICH_STYLES, process.cwd());

    expect(mockResolveCommandTags).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { isDryRun: false, tagsOnly: false });
  });

  it('passes isDryRun when --dry-run is provided', async () => {
    await pushCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { isDryRun: true, tagsOnly: false });
  });

  it('passes tagsOnly when --tags-only is provided', async () => {
    await pushCommand(['--tags-only'], RICH_STYLES, process.cwd());

    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { isDryRun: false, tagsOnly: true });
  });

  it('passes tags filter to resolveCommandTags', async () => {
    await pushCommand(['--tags=core-v1.2.0,cli-v0.5.0'], RICH_STYLES, process.cwd());

    expect(mockResolveCommandTags).toHaveBeenCalledWith(['core-v1.2.0', 'cli-v0.5.0'], undefined);
  });

  it('combines --tags with --tags-only to push only the tag subset', async () => {
    await pushCommand(['--tags=core-v1.2.0', '--tags-only'], RICH_STYLES, process.cwd());

    expect(mockResolveCommandTags).toHaveBeenCalledWith(['core-v1.2.0'], undefined);
    expect(mockPushRelease).toHaveBeenCalledWith(TAGS, { isDryRun: false, tagsOnly: true });
  });

  it('propagates unknown-tag error from resolveCommandTags', async () => {
    mockResolveCommandTags.mockImplementation(() => {
      throw new ProcessExitError(1);
    });

    const error = await captureError(ProcessExitError, () =>
      pushCommand(['--tags=missing-v9.9.9'], RICH_STYLES, process.cwd()),
    );

    expect(error.code).toBe(1);
    expect(mockPushRelease).not.toHaveBeenCalled();
  });

  it('exits with code 1 when --only is passed (flag removed)', async () => {
    const error = await captureError(ProcessExitError, () => pushCommand(['--only=core'], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --only\n');
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => pushCommand(['--unknown'], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockPushRelease).not.toHaveBeenCalled();
  });

  describe('config loading', () => {
    it('loads a named --config once, resolved against the invocation directory', async () => {
      await pushCommand(['--config', 'elsewhere/alternative.config.ts'], RICH_STYLES, '/invoked/from');

      expect(mockLoadConfig).toHaveBeenCalledExactlyOnceWith('/invoked/from/elsewhere/alternative.config.ts');
    });

    it('passes the loaded config to resolveCommandTags', async () => {
      const config = { workspaces: [{ dir: 'cli', shouldExclude: true }] };
      mockLoadConfig.mockResolvedValue(config);

      await pushCommand([], RICH_STYLES, process.cwd());

      expect(mockResolveCommandTags).toHaveBeenCalledWith(undefined, config);
    });

    it('exits with code 1 before resolving tags when a named config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ProcessExitError, () =>
        pushCommand(['--config', 'elsewhere/absent.config.ts'], RICH_STYLES, process.cwd()),
      );

      expect(error.code).toBe(1);
      expect(stdioCapture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
      expect(mockResolveCommandTags).not.toHaveBeenCalled();
      expect(mockPushRelease).not.toHaveBeenCalled();
    });

    it('exits with code 1 when the default config fails validation', async () => {
      mockLoadConfig.mockResolvedValue({ workTypes: 'not-an-object' });

      const error = await captureError(ProcessExitError, () => pushCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderrChunks).toContain('Invalid config:\n');
      expect(mockPushRelease).not.toHaveBeenCalled();
    });

    it('does not push the tag of an excluded workspace and reports the skip', async () => {
      const actualModule = await vi.importActual<typeof import('../resolveCommandTags.ts')>('../resolveCommandTags.ts');
      mockResolveCommandTags.mockImplementation(actualModule.resolveCommandTags);
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/cli']));
      mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
        const dir = workspacePath.split('/').pop() ?? workspacePath;
        return {
          dir,
          name: `@test/${dir}`,
          tagPrefix: `${dir}-v`,
          workspacePath,
          isPublishable: true,
          packageFiles: [`${workspacePath}/package.json`],
          paths: [`${workspacePath}/**`],
        };
      });
      mockResolveReleaseTags.mockReturnValue(TAGS);
      mockLoadConfig.mockResolvedValue({ workspaces: [{ dir: 'cli', shouldExclude: true }] });
      using silencedConsole = silenceConsole(['warn']);

      await pushCommand([], RICH_STYLES, process.cwd());

      expect(silencedConsole.warn).toHaveBeenCalledWith(
        'Skipping cli-v0.5.0 (packages/cli): excluded by config (shouldExclude: true).',
      );
      expect(mockPushRelease).toHaveBeenCalledWith([TAGS[0]], { isDryRun: false, tagsOnly: false });
    });
  });

  describe('project tag', () => {
    const PROJECT_TAG: ResolvedTag = {
      tag: 'v0.13.0',
      kind: 'project',
      dir: '',
      workspacePath: '.',
      isPublishable: false,
    };

    beforeEach(async () => {
      const actualModule = await vi.importActual<typeof import('../resolveCommandTags.ts')>('../resolveCommandTags.ts');
      mockResolveCommandTags.mockImplementation(actualModule.resolveCommandTags);
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/cli']));
      mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
        const dir = workspacePath.split('/').pop() ?? workspacePath;
        return {
          dir,
          name: `@test/${dir}`,
          tagPrefix: `${dir}-v`,
          workspacePath,
          isPublishable: true,
          packageFiles: [`${workspacePath}/package.json`],
          paths: [`${workspacePath}/**`],
        };
      });
    });

    it('pushes the project tag alongside the workspace tags', async () => {
      mockResolveReleaseTags.mockReturnValue([...TAGS, PROJECT_TAG]);
      mockLoadConfig.mockResolvedValue({ project: {} });

      await pushCommand([], RICH_STYLES, process.cwd());

      expect(mockPushRelease).toHaveBeenCalledWith([...TAGS, PROJECT_TAG], { isDryRun: false, tagsOnly: false });
    });

    it('pushes the project tag when it is the only release tag', async () => {
      mockResolveReleaseTags.mockReturnValue([PROJECT_TAG]);
      mockLoadConfig.mockResolvedValue({
        project: {},
        workspaces: [
          { dir: 'core', shouldExclude: true },
          { dir: 'cli', shouldExclude: true },
        ],
      });

      await pushCommand([], RICH_STYLES, process.cwd());

      expect(mockPushRelease).toHaveBeenCalledWith([PROJECT_TAG], { isDryRun: false, tagsOnly: false });
      expect(stdioCapture.stderrChunks.join('')).not.toContain('HEAD does not have any release tags');
    });
  });

  it('exits with code 1 when pushRelease throws', async () => {
    mockPushRelease.mockImplementation(() => {
      throw new Error('push failed');
    });

    const error = await captureError(ProcessExitError, () => pushCommand([], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: push failed\n');
  });

  it('skips pushRelease when resolveCommandTags does not resolve any tags', async () => {
    mockResolveCommandTags.mockReturnValue([]);

    await pushCommand([], RICH_STYLES, process.cwd());

    expect(mockPushRelease).not.toHaveBeenCalled();
  });
});
