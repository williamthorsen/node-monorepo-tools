import { formatStatusLine, type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { listConsoleLines, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyCreateGithubReleaseCommandDefaults,
  mockCreateGithubReleases,
  mockDeriveReleaseNotesConfig,
  mockDeriveWorkspaceConfig,
  mockDiscoverWorkspaces,
  mockLoadConfig,
  mockResolveReleaseTags,
  resetCreateGithubReleaseCommandMocks,
} = await vi.hoisted(() => import('../test-utils/createGithubReleaseCommandMocks.ts'));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../resolveReleaseTags.ts'), () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock(import('../createGithubRelease.ts'), () => ({
  createGithubReleases: mockCreateGithubReleases,
}));

vi.mock(import('../deriveReleaseNotesConfig.ts'), () => ({
  deriveReleaseNotesConfig: mockDeriveReleaseNotesConfig,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const originalModule = await importOriginal();
  return {
    ...originalModule,
    loadConfig: mockLoadConfig,
    readRootPackageVersion: () => ({ doesExist: true, version: '1.0.0' }),
  };
});

import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { ConfigProblemError } from '../loadValidatedConfig.ts';
import { makeCreateGithubReleaseOptions } from '../test-utils/commandOptions.ts';
import { makeResolvedPackages } from '../test-utils/workspaceResolutions.ts';

const PLAIN_STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };
const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(createGithubReleaseCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyCreateGithubReleaseCommandDefaults();
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetCreateGithubReleaseCommandMocks();
    vi.restoreAllMocks();
  });

  it('creates GitHub Releases for all tags on HEAD when --tags is omitted', async () => {
    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true }],
      '.meta/changelog.json',
      false,
      ['Bug fixes', 'Features'],
    );
  });

  it('passes --dry-run to createGithubReleases', async () => {
    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
    );
  });

  it('filters tags by --tags using full tag names in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0'], styles: RICH_STYLES }));

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true }],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('filters multiple tags by --tags', async () => {
    mockDiscoverWorkspaces.mockReturnValue(
      makeResolvedPackages(['packages/core', 'packages/release-kit', 'packages/extra']),
    );
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
      { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
    ]);

    await createGithubReleaseCommand(
      makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0', 'extra-v0.1.0'], styles: RICH_STYLES }),
    );

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
      ],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('exits with code 1 for a named config that fails to load before an all-private tag set returns', async () => {
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
    ]);
    mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

    const error = await captureError(ConfigProblemError, () =>
      createGithubReleaseCommand(
        makeCreateGithubReleaseOptions({ configPath: '/repo/elsewhere/absent.config.ts', styles: RICH_STYLES }),
      ),
    );

    expect(error.problem).toStrictEqual({
      kind: 'load',
      message: 'Config file not found: /repo/elsewhere/absent.config.ts',
    });
    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('exits with code 1 for a default config that fails to load before an all-private tag set returns', async () => {
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
    ]);
    mockLoadConfig.mockRejectedValue(new Error('Unexpected token in config'));

    const error = await captureError(ConfigProblemError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES })),
    );

    expect(error.problem).toStrictEqual({ kind: 'load', message: 'Unexpected token in config' });
    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('exits with code 1 for an invalid default config before an all-private tag set returns', async () => {
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
    ]);
    mockLoadConfig.mockResolvedValue({ workTypes: 'not-an-object' });

    const error = await captureError(ConfigProblemError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES })),
    );

    expect(error.problem.kind).toBe('validation');
    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('loads a named --config once', async () => {
    await createGithubReleaseCommand(
      makeCreateGithubReleaseOptions({
        configPath: '/invoked/from/elsewhere/alternative.config.ts',
        styles: RICH_STYLES,
      }),
    );

    expect(mockLoadConfig).toHaveBeenCalledExactlyOnceWith('/invoked/from/elsewhere/alternative.config.ts');
  });

  it('derives release-notes settings from the loaded config', async () => {
    mockLoadConfig.mockResolvedValue({ changelogJson: { outputPath: 'custom/changelog.json' } });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
    expect(mockDeriveReleaseNotesConfig).toHaveBeenCalledWith({
      changelogJson: { outputPath: 'custom/changelog.json' },
    });
  });

  it('prints each config warning once', async () => {
    using silent = silenceConsole(['warn']);
    mockLoadConfig.mockResolvedValue({
      changelogJson: { enabled: false },
      releaseNotes: { shouldInjectIntoReadme: true },
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    const warnings = silent.warn.mock.calls.filter(([message]) => String(message).includes('shouldInjectIntoReadme'));
    expect(warnings).toHaveLength(1);
  });

  it('does not create a Release for an excluded workspace, and reports the skip', async () => {
    using silent = silenceConsole(['warn']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/legacy']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'legacy-v0.9.0', kind: 'package', dir: 'legacy', workspacePath: 'packages/legacy', isPublishable: true },
    ]);
    mockLoadConfig.mockResolvedValue({ workspaces: [{ dir: 'legacy', shouldExclude: true }] });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    expect(listConsoleLines(silent.warn)).toContain(
      'Skipping legacy-v0.9.0 (packages/legacy): excluded by config (shouldExclude: true).',
    );
    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true }],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('exits 0 without creating a Release when every tag on HEAD is excluded', async () => {
    using _silencedConsole = silenceConsole(['warn']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/legacy']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'legacy-v0.9.0', kind: 'package', dir: 'legacy', workspacePath: 'packages/legacy', isPublishable: true },
    ]);
    mockLoadConfig.mockResolvedValue({ workspaces: [{ dir: 'legacy', shouldExclude: true }] });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
    expect(stdioCapture.stderr).toBe('');
  });

  it('exits with code 1 when it does not find any release tags on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    const error = await captureError(UserError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES })),
    );

    expect(error.message).toBe('HEAD does not have any release tags. Create tags with `release-kit tag` first.');
  });

  it('exits with code 1 when --tags references an unmatched tag', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);

    const error = await captureError(UsageError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ tags: ['core-v9.9.9'], styles: RICH_STYLES })),
    );

    expect(error.message).toBe('Unknown tag "core-v9.9.9" in --tags. Available: core-v1.3.0');
  });

  it('rethrows the UserError when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockImplementation(() => {
      throw new UserError('discovery failed');
    });

    const error = await captureError(UserError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES })),
    );
    expect(error.message).toBe('Failed to discover workspaces: discovery failed');
  });

  it('does not exit when --tags is explicit and every skip is no-entry', async () => {
    using silent = silenceConsole(['info']);
    // `resolveCommandTags` exits 1 on an unknown `--tags` value, so a no-entry skip that this command receives
    // means "no releasable content", as no-audience-content and empty-body do.
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/extra']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [
        { tag: 'core-v1.3.0', reason: 'no-entry' },
        { tag: 'extra-v0.1.0', reason: 'no-entry' },
      ],
    });

    await createGithubReleaseCommand(
      makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0', 'extra-v0.1.0'], styles: RICH_STYLES }),
    );

    expect(stdioCapture.stderr).toBe('');
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 2 tag(s) without releasable content: core-v1.3.0 (no-entry), extra-v0.1.0 (no-entry).',
    );
  });

  it('warns on stderr for a missing or unreadable changelog and leaves it out of the summary', async () => {
    using silent = silenceConsole(['info', 'warn']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/extra', 'packages/more']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
      { tag: 'more-v2.0.0', kind: 'package', dir: 'more', workspacePath: 'packages/more', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [
        { tag: 'core-v1.3.0', reason: 'missing-file', changelogJsonPath: 'packages/core/.meta/changelog.json' },
        { tag: 'extra-v0.1.0', reason: 'unreadable-file', changelogJsonPath: 'packages/extra/.meta/changelog.json' },
        { tag: 'more-v2.0.0', reason: 'no-entry', changelogJsonPath: 'packages/more/.meta/changelog.json' },
      ],
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: PLAIN_STYLES }));

    expect(listConsoleLines(silent.warn)).toStrictEqual([
      `  ${formatStatusLine('plain', 'warning', 'Skipping GitHub Release for core-v1.3.0: packages/core/.meta/changelog.json not found')}`,
      `  ${formatStatusLine('plain', 'warning', 'Skipping GitHub Release for extra-v0.1.0: could not parse packages/extra/.meta/changelog.json')}`,
    ]);
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: more-v2.0.0 (no-entry).',
    );
  });

  it('does not print a summary when every skip concerns the changelog file', async () => {
    using silent = silenceConsole(['info', 'warn']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [
        { tag: 'core-v1.3.0', reason: 'missing-file', changelogJsonPath: 'packages/core/.meta/changelog.json' },
      ],
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: PLAIN_STYLES }));

    expect(silent.warn).toHaveBeenCalledTimes(1);
    expect(listConsoleLines(silent.info).join('\n')).not.toContain('Skipped');
  });

  it('exits 0 when --tags is explicit and every skip is no-audience-content', async () => {
    using silent = silenceConsole(['info']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [{ tag: 'core-v1.3.0', reason: 'no-audience-content' }],
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0'], styles: RICH_STYLES }));

    expect(stdioCapture.stderr).toBe('');
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: core-v1.3.0 (no-audience-content).',
    );
  });

  it('exits 0 when --tags is explicit and the only skip reason is empty-body', async () => {
    using silent = silenceConsole(['info']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [{ tag: 'core-v1.3.0', reason: 'empty-body' }],
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0'], styles: RICH_STYLES }));

    expect(stdioCapture.stderr).toBe('');
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: core-v1.3.0 (empty-body).',
    );
  });

  it('logs an info summary when --tags has mixed outcomes including a no-entry skip', async () => {
    using silent = silenceConsole(['info']);
    // `resolveCommandTags` rejects an unknown tag, so this command reports a no-entry skip like any other skip.
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/extra']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: ['core-v1.3.0'],
      skippedTags: [{ tag: 'extra-v0.1.0', reason: 'no-entry' }],
    });

    await createGithubReleaseCommand(
      makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0', 'extra-v0.1.0'], styles: RICH_STYLES }),
    );

    expect(stdioCapture.stderr).toBe('');
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: extra-v0.1.0 (no-entry).',
    );
  });

  it('does not exit when --tags is omitted and every tag is skipped', async () => {
    using silent = silenceConsole(['info']);
    // When the user did not single out tags, an all-skipped outcome is informational, not a failure.
    mockCreateGithubReleases.mockReturnValue({
      createdTags: [],
      skippedTags: [{ tag: 'v1.0.0', reason: 'no-audience-content' }],
    });

    await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: v1.0.0 (no-audience-content).',
    );
  });

  it('logs an info summary when some tags are skipped (intentional reasons) but others succeed', async () => {
    using silent = silenceConsole(['info']);
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/extra']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'extra-v0.1.0', kind: 'package', dir: 'extra', workspacePath: 'packages/extra', isPublishable: true },
    ]);
    mockCreateGithubReleases.mockReturnValue({
      createdTags: ['core-v1.3.0'],
      skippedTags: [{ tag: 'extra-v0.1.0', reason: 'no-audience-content' }],
    });

    await createGithubReleaseCommand(
      makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0', 'extra-v0.1.0'], styles: RICH_STYLES }),
    );

    expect(stdioCapture.stderr).toBe('');
    expect(listConsoleLines(silent.info)).toContain(
      'Skipped 1 tag(s) without releasable content: extra-v0.1.0 (no-audience-content).',
    );
  });

  it('rethrows the UserError when createGithubReleases throws', async () => {
    mockCreateGithubReleases.mockImplementation(() => {
      throw new UserError('gh release failed');
    });

    const error = await captureError(UserError, () =>
      createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES })),
    );
    expect(error.message).toBe('Failed to create GitHub Releases: gh release failed');
  });

  describe('publishability filter', () => {
    it('skips a private workspace with a warning and does not create a Release', async () => {
      using silent = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(listConsoleLines(silent.warn)).toContain(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(mockCreateGithubReleases).not.toHaveBeenCalled();
    });

    it('no-ops without deriving release-notes settings when every tag is private', async () => {
      using _silencedConsole = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(mockDeriveReleaseNotesConfig).not.toHaveBeenCalled();
      expect(stdioCapture.stderr).toBe('');
    });

    it('creates Releases for publishable tags and warns about and skips the private one in a mixed set', async () => {
      using silent = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(listConsoleLines(silent.warn)).toContain(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        [{ tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true }],
        '.meta/changelog.json',
        false,
        ['Bug fixes', 'Features'],
      );
    });
  });

  describe('project tag', () => {
    const PROJECT_TAG = { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false };

    it('creates a Release for the project tag although the root package is private', async () => {
      using silent = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([PROJECT_TAG]);
      mockLoadConfig.mockResolvedValue({ project: {} });

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(silent.warn).not.toHaveBeenCalled();
      expect(mockCreateGithubReleases).toHaveBeenCalledWith([PROJECT_TAG], '.meta/changelog.json', false, [
        'Bug fixes',
        'Features',
      ]);
    });

    it('creates a Release for the project tag and still skips a private workspace tag', async () => {
      using silent = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
        PROJECT_TAG,
      ]);
      mockLoadConfig.mockResolvedValue({ project: {} });

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(listConsoleLines(silent.warn)).toStrictEqual([
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      ]);
      expect(mockCreateGithubReleases).toHaveBeenCalledWith([PROJECT_TAG], '.meta/changelog.json', false, [
        'Bug fixes',
        'Features',
      ]);
    });
  });

  describe('--tags parsing', () => {
    it('drops empty segments from --tags=foo, (trailing comma)', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      ]);

      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ tags: ['core-v1.3.0'], styles: RICH_STYLES }));

      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        [{ tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true }],
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('does not filter on --tags=, (only commas), preserving all HEAD tags', async () => {
      await createGithubReleaseCommand(makeCreateGithubReleaseOptions({ styles: RICH_STYLES }));

      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        [{ tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true }],
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
