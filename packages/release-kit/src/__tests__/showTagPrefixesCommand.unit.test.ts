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

// Partial, so that `reportConfigProblem` stays the real renderer: the stderr form a caller emits on an
// unusable config is the subject of the assertions below.
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('.');
    expect(capture.stdout).toContain('v');
    expect(capture.stdout).toContain('single-package mode');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('forwards the loaded config to the preview', async () => {
    const config = { workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@old/core', tagPrefix: 'core-v' }] }] };
    mockLoadValidatedConfig.mockResolvedValue({ status: 'ok', config, configFilePath: CONFIG_FILE_PATH, warnings: [] });
    mockPreview.mockReturnValue({ workspaces: [], collisions: [], undeclaredCandidates: [] });
    using _capture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(mockPreview).toHaveBeenCalledWith(config);
  });

  it('forwards the config path to the loader ahead of the repo-type branch', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    using _capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES, 'elsewhere/alternative.config.ts');

    expect(exitCode).toBe(0);
    expect(mockLoadValidatedConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
  });

  it('previews against derived defaults when no config file exists', async () => {
    mockPreview.mockReturnValue({ workspaces: [], collisions: [], undeclaredCandidates: [] });
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(mockPreview).toHaveBeenCalledWith(undefined);
    expect(capture.stdout).toContain('Workspace tag prefixes:');
  });

  it('exits 1, reports the problem, and prints no preview when the config is unusable', async () => {
    mockLoadValidatedConfig.mockResolvedValue({
      status: 'invalid',
      configFilePath: CONFIG_FILE_PATH,
      problem: { kind: 'validation', errors: ['workTypes: expected object'] },
    });
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(capture.stdout).toBe('');
    expect(capture.stderrChunks).toContain('Invalid config:\n');
    expect(capture.stderr).toContain('workTypes: expected object');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('exits 1 and reports the problem in single-package mode when the config is unusable', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    mockLoadValidatedConfig.mockResolvedValue({
      status: 'invalid',
      configFilePath: 'elsewhere/alternative.config.ts',
      problem: { kind: 'load', message: 'config read failure' },
    });
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES, 'elsewhere/alternative.config.ts');

    expect(exitCode).toBe(1);
    expect(capture.stdout).toBe('');
    expect(capture.stderr).toContain('Failed to load config: config read failure');
  });

  it('exits 1 and reports when the preview itself fails', async () => {
    mockPreview.mockImplementation(() => {
      throw new Error('Failed to read pnpm-workspace.yaml');
    });
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(capture.stderr).toContain('Failed to read pnpm-workspace.yaml');
    expect(capture.stderr).not.toContain('Failed to load config');
  });

  it('exits 0 when every workspace derives a prefix and no collisions or undeclared exist', async () => {
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('packages/core');
    expect(capture.stdout).toContain("derived prefix 'nmr-core-v'");
    expect(capture.stdout).toContain('2 tags');
  });

  it('surfaces the declared legacy-prefix line with a recognized marker when tags exist', async () => {
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
    using capture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(capture.stdout).toContain("3 legacy tags with 'core-v' prefix (recognized)");
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
    using capture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(capture.stdout).toContain("recorded legacy prefix 'obsolete-v' has no tags");
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(capture.stdout).toContain('❌ derivation failed');
    expect(capture.stdout).toContain("missing a 'name' field");
  });

  it.each([
    { style: 'rich', failed: '❌', passed: '✅', warning: '🟠' },
    { style: 'plain', failed: 'FAIL ', passed: 'PASS ', warning: 'WARN ' },
  ] as const)('marks every status in the $style style of stdout', async ({ style, failed, passed, warning }) => {
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
    using capture = captureStdio();

    await showTagPrefixesCommand({ stderr: 'rich', stdout: style });

    expect(capture.stdout).toContain(`packages/broken — ${failed} derivation failed: no name`);
    expect(capture.stdout).toContain(`derived prefix 'new-v', ${warning} no existing tags`);
    expect(capture.stdout).toContain(`derived prefix 'core-v', ${passed} 2 tags`);
    expect(capture.stdout).toContain(`      ${passed} 3 legacy tags with 'old-v' prefix (recognized)`);
    expect(capture.stdout).toContain(`      ${warning} recorded legacy prefix 'obsolete-v' has no tags`);
    expect(capture.stdout).toContain(`\n${failed} tag prefix collision: 'core-v' used by`);
    expect(/\p{Extended_Pictographic}/u.test(capture.stdout)).toBe(style === 'rich');
  });

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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(capture.stdout).toContain('tag prefix collision');
    expect(capture.stdout).toContain('packages/a-foo, packages/b-foo');
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('Undeclared tag prefixes');
    expect(capture.stdout).toContain("'core-v'");
    expect(capture.stdout).toContain('core-v0.2.7');
    expect(capture.stdout).toContain("dir: 'core'");
    expect(capture.stdout).toContain(
      "legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: 'core-v' }]",
    );
    expect(capture.stdout).toContain('TODO-fill-in-legacy-npm-name');
  });
});
