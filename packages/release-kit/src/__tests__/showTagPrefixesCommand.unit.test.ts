import { type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
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

import type { TagPrefixPreview, TagPrefixPreviewRow } from '../previewTagPrefixes.ts';
import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';

const PLAIN_STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };
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

  it('renders a single-package block and exits 0 in single-package mode', async () => {
    mockDetectRepoType.mockReturnValue('single-package');
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toBe(
      ['Workspace tag prefixes', '', '. (single-package mode)', '  derived prefix    v', ''].join('\n'),
    );
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('forwards the loaded config to the preview', async () => {
    const config = { workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@old/core', tagPrefix: 'core-v' }] }] };
    mockLoadValidatedConfig.mockResolvedValue({ status: 'ok', config, configFilePath: CONFIG_FILE_PATH, warnings: [] });
    mockPreview.mockReturnValue(makePreview());
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
    mockPreview.mockReturnValue(makePreview());
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(0);
    expect(mockPreview).toHaveBeenCalledWith(undefined);
    expect(stdioCapture.stdout).toContain('Workspace tag prefixes');
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
      throw new UserError('Failed to read pnpm-workspace.yaml');
    });
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(RICH_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stderr).toContain('Failed to read pnpm-workspace.yaml');
    expect(stdioCapture.stderr).not.toContain('Failed to load config');
  });

  it('rethrows a crash in the preview unchanged', async () => {
    const crash = new TypeError('Cannot read properties of undefined');
    mockPreview.mockImplementation(() => {
      throw crash;
    });

    await expect(captureError(TypeError, () => showTagPrefixesCommand(RICH_STYLES))).resolves.toBe(crash);
  });

  it('renders each target as a block with aligned prefix and count columns', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({
            workspacePath: 'packages/nmr-core',
            name: '@s/nmr-core',
            derivedPrefix: 'nmr-core-v',
            derivedTagCount: 36,
            legacyEntries: [{ name: '@s/node-monorepo-core', prefix: 'core-v', tagCount: 7 }],
          }),
          makeRow({
            workspacePath: 'packages/release-kit',
            name: '@s/release-kit',
            derivedPrefix: 'release-kit-v',
            derivedTagCount: 5,
          }),
        ],
        retiredPackages: [{ name: '@s/preflight', tagPrefix: 'preflight-v', successor: 'readyup', tagCount: 8 }],
      }),
    );
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toBe(
      [
        'Workspace tag prefixes',
        '',
        'packages/nmr-core (@s/nmr-core)',
        '  derived prefix    PASS  nmr-core-v     36 tags',
        '  legacy identity   PASS  core-v          7 tags  @s/node-monorepo-core',
        '',
        'packages/release-kit (@s/release-kit)',
        '  derived prefix    PASS  release-kit-v   5 tags',
        '',
        'Retired packages',
        '',
        '  PASS  preflight-v     8 tags  @s/preflight, successor: readyup',
        '',
        'Undeclared tag prefixes',
        '',
        '  (none)',
        '',
      ].join('\n'),
    );
  });

  it('renders a single target with a passing derived prefix and exits 0', async () => {
    mockPreview.mockReturnValue(makePreview({ workspaces: [makeRow({ derivedTagCount: 2 })] }));
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain(
      'packages/core (@s/nmr-core)\n  derived prefix    PASS  nmr-core-v  2 tags\n',
    );
  });

  it('titles a block with its path alone when the target does not have a name', async () => {
    mockPreview.mockReturnValue(makePreview({ workspaces: [makeRow({ name: null, derivedTagCount: 1 })] }));
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(PLAIN_STYLES);

    expect(stdioCapture.stdout).toContain('\npackages/core\n');
  });

  it('warns on a legacy identity or a retired package that does not have any tags', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({
            derivedTagCount: 1,
            legacyEntries: [{ name: '@old/core', prefix: 'obsolete-v', tagCount: 0 }],
          }),
        ],
        retiredPackages: [{ name: '@s/dead', tagPrefix: 'dead-v', tagCount: 0 }],
      }),
    );
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(PLAIN_STYLES);

    expect(stdioCapture.stdout).toContain('  legacy identity   WARN  obsolete-v  0 tags  @old/core\n');
    expect(stdioCapture.stdout).toContain('\n  WARN  dead-v      0 tags  @s/dead\n');
  });

  it('omits the retired section when the config does not declare any retired package', async () => {
    mockPreview.mockReturnValue(makePreview({ workspaces: [makeRow({ derivedTagCount: 1 })] }));
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(PLAIN_STYLES);

    expect(stdioCapture.stdout).not.toContain('Retired packages');
  });

  it('prints the first-tag footer when a derived prefix does not have any tags', async () => {
    mockPreview.mockReturnValue(
      makePreview({ workspaces: [makeRow({ workspacePath: 'packages/new', derivedPrefix: 'new-v' })] }),
    );
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain('  derived prefix    WARN  new-v  0 tags  no derived tags yet\n');
    expect(stdioCapture.stdout).toContain(
      '\nINFO  A workspace marked "no derived tags yet" has not been released under its derived prefix. `release-kit tag` creates its first tag from the tags file that `release-kit prepare` writes.\n',
    );
  });

  it('omits the first-tag footer when every derived prefix has tags', async () => {
    mockPreview.mockReturnValue(makePreview({ workspaces: [makeRow({ derivedTagCount: 3 })] }));
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(PLAIN_STYLES);

    expect(stdioCapture.stdout).not.toContain('INFO');
  });

  it('exits 1 on derivation failure and prints the error without a footer', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({
            workspacePath: 'packages/broken',
            name: null,
            derivedPrefix: null,
            derivationError: "packages/broken/package.json is missing a 'name' field",
          }),
        ],
      }),
    );
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toContain(
      "packages/broken\n  derived prefix    FAIL  derivation failed: packages/broken/package.json is missing a 'name' field\n",
    );
    expect(stdioCapture.stdout).not.toContain('INFO');
  });

  it('exits 1 on collision and marks each colliding block with the other paths', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({ workspacePath: 'packages/a-foo', name: '@s/a-foo', derivedPrefix: 'foo-v', derivedTagCount: 1 }),
          makeRow({ workspacePath: 'packages/b-foo', name: '@s/b-foo', derivedPrefix: 'foo-v', derivedTagCount: 1 }),
        ],
        collisions: [{ tagPrefix: 'foo-v', workspacePaths: ['packages/a-foo', 'packages/b-foo'] }],
      }),
    );
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(1);
    expect(stdioCapture.stdout).toContain(
      'packages/a-foo (@s/a-foo)\n  derived prefix    FAIL  foo-v  1 tags  collides with packages/b-foo\n',
    );
    expect(stdioCapture.stdout).toContain(
      'packages/b-foo (@s/b-foo)\n  derived prefix    FAIL  foo-v  1 tags  collides with packages/a-foo\n',
    );
  });

  it('prints the undeclared section with a copy-pasteable snippet and does not affect exit code', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [makeRow({ derivedTagCount: 1 })],
        undeclaredCandidates: [
          { prefix: 'core-v', tagCount: 2, exampleTags: ['core-v0.2.7', 'core-v0.2.8'], suggestedDir: 'core' },
        ],
      }),
    );
    using stdioCapture = captureStdio();

    const exitCode = await showTagPrefixesCommand(PLAIN_STYLES);

    expect(exitCode).toBe(0);
    expect(stdioCapture.stdout).toContain(
      "Undeclared tag prefixes\n\n  WARN  'core-v': 2 tags (e.g., core-v0.2.7, core-v0.2.8)\n",
    );
    expect(stdioCapture.stdout).toContain(
      "{ dir: 'core', legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: 'core-v' }] },",
    );
    expect(stdioCapture.stdout).not.toContain('(none)');
  });

  it('marks every status through the glyph set in the rich style', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({ workspacePath: 'packages/broken', name: null, derivedPrefix: null, derivationError: 'no name' }),
          makeRow({ workspacePath: 'packages/new', derivedPrefix: 'new-v' }),
          makeRow({ derivedPrefix: 'core-v', derivedTagCount: 2 }),
        ],
      }),
    );
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(RICH_STYLES);

    expect(stdioCapture.stdout).toContain('❌ derivation failed: no name');
    expect(stdioCapture.stdout).toContain('🟠 new-v   0 tags  no derived tags yet');
    expect(stdioCapture.stdout).toContain('✅ core-v  2 tags');
  });

  it('prints no emoji in the plain style', async () => {
    mockPreview.mockReturnValue(
      makePreview({
        workspaces: [
          makeRow({ workspacePath: 'packages/broken', name: null, derivedPrefix: null, derivationError: 'no name' }),
          makeRow({ workspacePath: 'packages/new', derivedPrefix: 'new-v' }),
        ],
        retiredPackages: [{ name: '@s/dead', tagPrefix: 'dead-v', tagCount: 0 }],
      }),
    );
    using stdioCapture = captureStdio();

    await showTagPrefixesCommand(PLAIN_STYLES);

    expect(/\p{Extended_Pictographic}/u.test(stdioCapture.stdout)).toBe(false);
  });
});

// region | Helpers

/** Builds a tag-prefix preview whose sections default to empty. */
function makePreview(overrides: Partial<TagPrefixPreview> = {}): TagPrefixPreview {
  return { workspaces: [], collisions: [], undeclaredCandidates: [], retiredPackages: [], ...overrides };
}

/** Builds a preview row for `packages/core` that derives `nmr-core-v` without tags, unless overridden. */
function makeRow(overrides: Partial<TagPrefixPreviewRow> = {}): TagPrefixPreviewRow {
  return {
    workspacePath: 'packages/core',
    dir: 'core',
    name: '@s/nmr-core',
    derivedPrefix: 'nmr-core-v',
    derivationError: null,
    derivedTagCount: 0,
    legacyEntries: [],
    ...overrides,
  };
}

// endregion | Helpers
