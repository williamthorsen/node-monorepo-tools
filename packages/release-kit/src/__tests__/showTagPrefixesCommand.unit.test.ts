import type { StreamStyles } from '@williamthorsen/nmr-core';
import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPreview = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());
const mockLoadValidatedConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../previewTagPrefixes.ts'), () => ({
  previewTagPrefixes: mockPreview,
}));

vi.mock(import('../init/detectRepoType.ts'), () => ({
  detectRepoType: mockDetectRepoType,
}));

// Partial, so that `reportConfigProblem` stays the real renderer: The stderr form that a caller emits
// on an unusable config is the subject of the assertions below.
vi.mock(import('../loadValidatedConfig.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadValidatedConfig: mockLoadValidatedConfig,
}));

import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };
const CONFIG_FILE_PATH = '.config/release-kit.config.ts';

describe(showTagPrefixesCommand, () => {
  beforeEach(() => {
    mockDetectRepoType.mockReturnValue('monorepo');
    mockLoadValidatedConfig.mockResolvedValue({ status: 'missing', configFilePath: CONFIG_FILE_PATH });
  });

  afterEach(() => {
    mockPreview.mockReset();
    mockDetectRepoType.mockReset();
    mockLoadValidatedConfig.mockReset();
  });

  it('renders a single-package row and exits 0 in single-package mode', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain('.');
    expect(stdioCapture.stdout).toContain('v');
    expect(stdioCapture.stdout).toContain('single-package mode');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('forwards the loaded config to the preview', async () => {
    const config = { workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@old/core', tagPrefix: 'core-v' }] }] };
    mockLoadValidatedConfig.mockResolvedValue({ status: 'ok', config, configFilePath: CONFIG_FILE_PATH, warnings: [] });
    mockPreview.mockReturnValue({ workspaces: [], collisions: [], undeclaredCandidates: [] });
    using _stdioCapture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(mockPreview).toHaveBeenCalledWith(config);
  });

  it('forwards the config path to the loader ahead of the repo-type branch', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    using _stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES, 'elsewhere/alternative.config.ts');

    expect(exitCode).toBe(0);
    expect(mockLoadValidatedConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
  });

  it('previews against derived defaults when the config file is missing', async () => {
    mockPreview.mockReturnValue({ workspaces: [], collisions: [], undeclaredCandidates: [] });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(mockPreview).toHaveBeenCalledWith(undefined);
    expect(stdioCapture.stdout).toContain('Workspace tag prefixes:');
  });

  it('exits 1, reports the problem, and does not print a preview when the config is unusable', async () => {
    mockLoadValidatedConfig.mockResolvedValue({
      status: 'invalid',
      configFilePath: CONFIG_FILE_PATH,
      problem: { kind: 'validation', errors: ['workTypes: expected object'] },
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toBe('');
    expect(stdioCapture.stderrChunks).toContain('Invalid config:\n');
    expect(stdioCapture.stderr).toContain('workTypes: expected object');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('exits 1 and reports the problem in single-package mode when the config is unusable', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    mockLoadValidatedConfig.mockResolvedValue({
      status: 'invalid',
      configFilePath: 'elsewhere/alternative.config.ts',
      problem: { kind: 'load', message: 'config read failure' },
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES, 'elsewhere/alternative.config.ts');

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toBe('');
    expect(stdioCapture.stderr).toContain('Failed to load config: config read failure');
  });

  it('exits 1 and reports when the preview itself fails', async () => {
    mockPreview.mockImplementation(() => {
      throw new Error('Failed to read pnpm-workspace.yaml');
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stderr).toContain('Failed to read pnpm-workspace.yaml');
    expect(stdioCapture.stderr).not.toContain('Failed to load config');
  });

  it('exits 0 when every workspace derives a prefix and the preview does not report any collision or undeclared prefix', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
          derivationError: null,
          derivedTagCount: 2,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain('packages/core');
    expect(stdioCapture.stdout).toContain("derived prefix 'nmr-core-v'");
    expect(stdioCapture.stdout).toContain('2 tags');
  });

  it('prints the declared legacy-prefix line with a recognized marker when tags exist', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [{ prefix: 'core-v', tagCount: 3 }],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(stdioCapture.stdout).toContain("3 legacy tags with 'core-v' prefix (recognized)");
  });

  it('notes declared-but-empty legacy prefixes', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'core-v',
          derivationError: null,
          derivedTagCount: 1,
          legacyEntries: [{ prefix: 'obsolete-v', tagCount: 0 }],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(stdioCapture.stdout).toContain("recorded legacy prefix 'obsolete-v' does not have any tags");
  });

  it('exits 1 on derivation failure and prints the error', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/broken',
          dir: 'broken',
          derivedPrefix: null,
          derivationError: "packages/broken/package.json is missing a 'name' field",
          derivedTagCount: 0,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toContain('❌ derivation failed');
    expect(stdioCapture.stdout).toContain("missing a 'name' field");
  });

  it.each([
    { style: 'rich', failedMarker: '❌', passedMarker: '✅', warningMarker: '🟠' },
    { style: 'plain', failedMarker: 'FAIL ', passedMarker: 'PASS ', warningMarker: 'WARN ' },
  ] as const)(
    'marks every status in the $style style of stdout',
    async ({ style, failedMarker, passedMarker, warningMarker }) => {
      const row = { dir: 'core', derivationError: null, legacyEntries: [] };
      mockPreview.mockReturnValue({
        workspaces: [
          {
            ...row,
            workspacePath: 'packages/broken',
            derivedPrefix: null,
            derivationError: 'no name',
            derivedTagCount: 0,
          },
          { ...row, workspacePath: 'packages/new', derivedPrefix: 'new-v', derivedTagCount: 0 },
          {
            ...row,
            workspacePath: 'packages/core',
            derivedPrefix: 'core-v',
            derivedTagCount: 2,
            legacyEntries: [
              { prefix: 'old-v', tagCount: 3 },
              { prefix: 'obsolete-v', tagCount: 0 },
            ],
          },
        ],
        collisions: [{ tagPrefix: 'core-v', workspacePaths: ['packages/core', 'packages/other'] }],
        undeclaredCandidates: [],
      });
      using stdioCapture = captureStdio();

      await showTagPrefixesCommand({ stderr: 'rich', stdout: style });

      expect(stdioCapture.stdout).toContain(`packages/broken: ${failedMarker} derivation failed: no name`);
      expect(stdioCapture.stdout).toContain(`derived prefix 'new-v', ${warningMarker} no existing tags`);
      expect(stdioCapture.stdout).toContain(`derived prefix 'core-v', ${passedMarker} 2 tags`);
      expect(stdioCapture.stdout).toContain(`      ${passedMarker} 3 legacy tags with 'old-v' prefix (recognized)`);
      expect(stdioCapture.stdout).toContain(
        `      ${warningMarker} recorded legacy prefix 'obsolete-v' does not have any tags`,
      );
      expect(stdioCapture.stdout).toContain(`\n${failedMarker} tag prefix collision: 'core-v' used by`);
      expect(/\p{Extended_Pictographic}/u.test(stdioCapture.stdout)).toBe(style === 'rich');
    },
  );

  it('exits 1 on collision and names the colliding workspaces', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/a-foo',
          dir: 'a-foo',
          derivedPrefix: 'foo-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [],
        },
        {
          workspacePath: 'packages/b-foo',
          dir: 'b-foo',
          derivedPrefix: 'foo-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [],
        },
      ],
      collisions: [{ tagPrefix: 'foo-v', workspacePaths: ['packages/a-foo', 'packages/b-foo'] }],
      undeclaredCandidates: [],
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toContain('tag prefix collision');
    expect(stdioCapture.stdout).toContain('packages/a-foo, packages/b-foo');
  });

  it('prints the undeclared section with a copy-pasteable snippet and does not affect exit code', async () => {
    mockPreview.mockReturnValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
          derivationError: null,
          derivedTagCount: 1,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [
        { prefix: 'core-v', tagCount: 2, exampleTags: ['core-v0.2.7', 'core-v0.2.8'], suggestedDir: 'core' },
      ],
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain('Undeclared tag prefixes');
    expect(stdioCapture.stdout).toContain("'core-v'");
    expect(stdioCapture.stdout).toContain('core-v0.2.7');
    expect(stdioCapture.stdout).toContain("dir: 'core'");
    expect(stdioCapture.stdout).toContain(
      "legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: 'core-v' }]",
    );
    expect(stdioCapture.stdout).toContain('TODO-fill-in-legacy-npm-name');
  });
});
