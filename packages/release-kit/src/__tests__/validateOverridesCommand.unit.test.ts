import type { StreamStyles } from '@williamthorsen/nmr-core';
import { createTempTree, pointCwdAt, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enumerateReleaseWindows } from '../enumerateReleaseWindows.ts';
import type { GenerateChangelogOptions } from '../generateChangelogs.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { emptyWorkspace, resolvedPackages, singlePackage } from '../test-utils/workspaceResolutions.ts';
import type { ChangelogEntry } from '../types.ts';
import { formatValidateOverridesResult, validateOverridesCommand } from '../validateOverridesCommand.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

// Stub `enumerateReleaseWindows` so the near-integration block can exercise the real
// `validateOverridesCommand → buildChangelogEntries → validateAllChangelogOverrides` pipeline
// without reading git history. Other tests in this file inject `buildEntries` directly,
// so they never reach the stubbed call site.
vi.mock(import('../enumerateReleaseWindows.ts'), () => ({
  enumerateReleaseWindows: vi.fn(() => []),
}));

const mockedEnumerateReleaseWindows = vi.mocked(enumerateReleaseWindows);

/**
 * Wrap a flat list of hashes into the minimal `ChangelogEntry[]` shape that the production
 * code's `flattenEntriesToHashes` walks. Use {@link entriesFromReleases} when a test needs to
 * differentiate per-release groupings (e.g., past vs. unreleased).
 */
function entriesFromHashes(hashes: string[]): ChangelogEntry[] {
  return entriesFromReleases([{ version: '0.0.0-test', hashes }]);
}

/** Build a multi-release entry tree. Each spec becomes one `ChangelogEntry`. */
function entriesFromReleases(specs: { version: string; hashes: string[] }[]): ChangelogEntry[] {
  return specs.map((spec) => ({
    version: spec.version,
    date: '0000-00-00',
    sections: [
      {
        title: 'Test',
        audience: 'all',
        items: spec.hashes.map((hash) => ({ description: '', hash })),
      },
    ],
  }));
}

describe(formatValidateOverridesResult, () => {
  it('returns exit 0 with a success message when there are no findings', () => {
    const result = formatValidateOverridesResult({ errors: [], warnings: [] }, 'rich');
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/valid/);
  });

  it('returns exit 1 with only warnings rendered (zero-count error category is omitted)', () => {
    const result = formatValidateOverridesResult(
      {
        errors: [],
        warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale99' did not match"],
      },
      'rich',
    );
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('Found 1 warning:');
    expect(result.message).not.toContain('error');
    expect(result.message).toContain('stale99');
    expect(result.message).not.toContain('❌');
    expect(result.message).toContain('🟠');
  });

  it('omits the warning category from the summary when only errors are present', () => {
    const result = formatValidateOverridesResult(
      {
        errors: ["file.json: Override key 'abc' is ambiguous: matches multiple commits"],
        warnings: [],
      },
      'rich',
    );
    expect(result.message).toContain('Found 1 error:');
    expect(result.message).not.toContain('warning');
  });

  it('returns exit 2 when any error is present, regardless of warnings', () => {
    const result = formatValidateOverridesResult(
      {
        errors: [".meta/changelog-overrides.json: Override key 'abc' is ambiguous: matches multiple commits"],
        warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale' did not match"],
      },
      'rich',
    );
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('ambiguous');
    expect(result.message).toContain('stale');
  });

  it('renders errors and warnings without a pictographic character in the plain style', () => {
    const findings = { errors: ['file.json: error a'], warnings: ['file.json: warn a'] };

    const plain = formatValidateOverridesResult(findings, 'plain');

    // The rich render proves that the fixture reaches both glyph-bearing branches.
    expect(formatValidateOverridesResult(findings, 'rich').message).toContain(
      '  ❌ file.json: error a\n  🟠 file.json: warn a',
    );
    expect(plain.message).toContain('  FAIL  file.json: error a\n  WARN  file.json: warn a');
    expect(plain.message).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('pluralizes the summary line', () => {
    const result = formatValidateOverridesResult(
      {
        errors: ['file.json: error a', 'file.json: error b'],
        warnings: ['file.json: warn a'],
      },
      'rich',
    );
    expect(result.message).toContain('Found 2 errors and 1 warning');
  });
});

describe(validateOverridesCommand, () => {
  it('returns exit 0 in a single-package layout with no overrides', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(0);
  });

  // The defect this change repairs: a workspace resolving to nothing used to read as single-package mode and
  // validate the root's overrides alone.
  it('returns exit 2 when the workspace resolves to no package', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: () => emptyWorkspace('all-excluded'),
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: [], warnings: [] }),
    });

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('No workspace package to validate.');
  });

  it('returns exit 1 when validation surfaces only warnings', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: [], warnings: ['file.json: stale key'] }),
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns exit 2 when validation surfaces errors', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: ['file.json: ambiguous'], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('returns exit 2 with a config-load failure message', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({
          status: 'invalid',
          configFilePath: '.config/release-kit.config.ts',
          problem: { kind: 'load', message: 'boom' },
        }),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('Error: Failed to load config');
    expect(result.message).toContain('boom');
  });

  it('returns exit 2 with an Invalid config message when the loaded config fails validation', async () => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({
          status: 'invalid',
          configFilePath: '.config/release-kit.config.ts',
          problem: { kind: 'validation', errors: ['Config must be an object'] },
        }),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('Invalid config');
    expect(result.message).toContain('Config must be an object');
    // The structured validation report is a verdict, not a command failure — it stays unprefixed.
    expect(result.message).not.toContain('Error:');
  });

  it.each([
    { label: 'a load failure', problem: { kind: 'load' as const, message: 'boom' } },
    { label: 'a validation failure', problem: { kind: 'validation' as const, errors: ['Config must be an object'] } },
  ])('returns exit 2 on $label, so that the problem kind picks the message alone', async ({ problem }) => {
    const result = await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'invalid', configFilePath: '.config/release-kit.config.ts', problem }),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('passes a project-only scope to validate in single-package mode', async () => {
    let received: { workspaces: number; projectItems: number } | undefined;
    await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => entriesFromHashes(['hash1', 'hash2']),
      validate: (inputs) => {
        received = {
          workspaces: inputs.workspaces?.length ?? 0,
          projectItems: inputs.project?.items?.length ?? 0,
        };
        return { errors: [], warnings: [] };
      },
    });
    expect(received).toStrictEqual({ workspaces: 0, projectItems: 2 });
  });

  // Bug-fix coverage: the validator's hash universe must be byte-equal to what `prepare`
  // walks. Tests below verify that the full multi-release tree (not just the latestTag..HEAD
  // window the prior implementation used) is delivered to the validator, and that the
  // downstream classification still surfaces unreachable keys and ambiguous prefixes correctly.

  it('delivers the full multi-release hash universe to the validator (past releases included)', async () => {
    // Regression for issue #398: prior to the fix, only the current unreleased window was
    // available to the validator. An override targeting a hash in a past release (here:
    // 'aabbcc1234') was reported stale because the validator never saw that hash.
    let capturedHashes: readonly string[] = [];
    await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () =>
        entriesFromReleases([
          { version: '1.0.0', hashes: ['aabbcc1234567890aabbcc1234567890aabbcc12'] },
          { version: '2.0.0', hashes: ['ddeeff5678901234ddeeff5678901234ddeeff56'] },
          { version: 'validate-only', hashes: ['9988aabbccddeeff9988aabbccddeeff9988aabb'] },
        ]),
      validate: (inputs) => {
        capturedHashes = (inputs.project?.items ?? []).map((item) => item.hash);
        return { errors: [], warnings: [] };
      },
    });
    expect(capturedHashes).toStrictEqual([
      'aabbcc1234567890aabbcc1234567890aabbcc12',
      'ddeeff5678901234ddeeff5678901234ddeeff56',
      '9988aabbccddeeff9988aabbccddeeff9988aabb',
    ]);
  });

  it("delivers each item's entry position to the validator", async () => {
    let captured: unknown;
    await validateOverridesCommand(RICH_STYLES, undefined, {
      discoverWorkspaces: singlePackage,
      loadValidatedConfig: () =>
        Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      buildEntries: () => [
        {
          version: 'validate-only',
          date: '0000-00-00',
          sections: [
            {
              title: 'Features',
              audience: 'all',
              items: [
                { description: 'First', hash: 'abc111', entry: 1 },
                { description: 'Second', hash: 'abc111', entry: 2 },
                { description: 'Titled', hash: 'def222' },
                { description: 'Synthetic' },
              ],
            },
          ],
        },
      ],
      validate: (inputs) => {
        captured = inputs.project?.items;
        return { errors: [], warnings: [] };
      },
    });
    expect(captured).toStrictEqual([{ hash: 'abc111', entry: 1 }, { hash: 'abc111', entry: 2 }, { hash: 'def222' }]);
  });

  describe('reading the config file named by configPath', () => {
    let tree: TempTree;

    beforeEach(() => {
      tree = disposeOnTestFinished(createTempTree({}, { prefix: 'validate-overrides-config-' }));
      disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
    });

    it('reads the named file rather than the default path', async () => {
      tree.write('elsewhere/alternative.config.ts', 'export default { unknownField: true };');

      const named = await validateOverridesCommand(RICH_STYLES, 'elsewhere/alternative.config.ts', {
        discoverWorkspaces: singlePackage,
        buildEntries: () => entriesFromHashes([]),
        validate: () => ({ errors: [], warnings: [] }),
      });
      const defaulted = await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: singlePackage,
        buildEntries: () => entriesFromHashes([]),
        validate: () => ({ errors: [], warnings: [] }),
      });

      expect(named.exitCode).toBe(2);
      expect(named.message).toContain('unknownField');
      expect(defaulted.exitCode).toBe(0);
    });

    it('returns exit 2 when the named file does not exist', async () => {
      const result = await validateOverridesCommand(RICH_STYLES, 'elsewhere/absent.config.ts', {
        discoverWorkspaces: singlePackage,
        buildEntries: () => entriesFromHashes([]),
        validate: () => ({ errors: [], warnings: [] }),
      });

      expect(result.exitCode).toBe(2);
      expect(result.message).toContain(`Config file not found: ${tree.resolve('elsewhere/absent.config.ts')}`);
    });
  });

  describe('against the real validator (writes a temp override file)', () => {
    let tree: TempTree;

    beforeEach(() => {
      tree = disposeOnTestFinished(createTempTree({}, { prefix: 'validate-overrides-' }));
      disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
    });

    function writeOverrides(overrides: Record<string, unknown>): void {
      tree.writeJson('.meta/changelog-overrides.json', overrides);
    }

    it('does NOT flag an override targeting a past-release commit as stale', async () => {
      const pastHash = 'aabbcc1234567890aabbcc1234567890aabbcc12';
      const unreleasedHash = '9988aabbccddeeff9988aabbccddeeff9988aabb';
      writeOverrides({ aabbcc12: { audience: 'skip' } });

      const result = await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: singlePackage,
        loadValidatedConfig: () =>
          Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
        buildEntries: () =>
          entriesFromReleases([
            { version: '1.0.0', hashes: [pastHash] },
            { version: 'validate-only', hashes: [unreleasedHash] },
          ]),
      });

      expect(result.exitCode).toBe(0);
      expect(result.message).not.toContain('aabbcc12');
      expect(result.message).not.toContain('did not match');
    });

    it('flags an override targeting an unreachable hash as stale', async () => {
      writeOverrides({ deadbeef: { audience: 'skip' } });

      const result = await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: singlePackage,
        loadValidatedConfig: () =>
          Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
        buildEntries: () =>
          entriesFromReleases([
            { version: '1.0.0', hashes: ['aabbcc1234567890aabbcc1234567890aabbcc12'] },
            { version: 'validate-only', hashes: ['9988aabbccddeeff9988aabbccddeeff9988aabb'] },
          ]),
      });

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('deadbeef');
      expect(result.message).toContain('stale');
    });

    it('surfaces an ambiguous-prefix error with file-path attribution', async () => {
      writeOverrides({ aa: { audience: 'skip' } });

      const result = await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: singlePackage,
        loadValidatedConfig: () =>
          Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
        buildEntries: () =>
          entriesFromReleases([
            {
              version: '1.0.0',
              hashes: ['aabbcc1234567890aabbcc1234567890aabbcc12', 'aabbdd5678901234aabbdd5678901234aabbdd56'],
            },
          ]),
      });

      expect(result.exitCode).toBe(2);
      expect(result.message).toContain('.meta/changelog-overrides.json:');
      expect(result.message).toContain('ambiguous');
      expect(result.message).toContain('aa');
    });
  });

  describe('near-integration: full pipeline with mocked release windows', () => {
    let tree: TempTree;

    beforeEach(() => {
      tree = disposeOnTestFinished(createTempTree({}, { prefix: 'validate-overrides-int-' }));
      disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
      mockedEnumerateReleaseWindows.mockReset();
      mockedEnumerateReleaseWindows.mockReturnValue([]);
    });

    it('exercises real validateOverridesCommand → buildChangelogEntries → validator over multiple release windows (#398)', async () => {
      // Canned windows simulating two releases plus the unreleased range, newest first.
      // The past-release commit `aabbcc12…` is what regressed prior to the fix: the narrow
      // `git log <latestTag>..HEAD` universe excluded it, causing a false-positive stale warning.
      // Each subject carries a ticket prefix, which `classifyChangelogCommit` requires.
      const pastHash = 'aabbcc1234567890aabbcc1234567890aabbcc12';
      const currentHash = 'ddeeff5678901234ddeeff5678901234ddeeff56';
      const unreleasedHash = '9988aabbccddeeff9988aabbccddeeff9988aabb';
      mockedEnumerateReleaseWindows.mockReturnValue([
        {
          version: 'unreleased',
          timestamp: 1_720_000_000,
          commits: makeStubbedCommits([['#3 feat: unreleased feature', unreleasedHash]]),
        },
        {
          version: 'v2.0.0',
          timestamp: 1_710_000_000,
          commits: makeStubbedCommits([['#2 feat: current feature', currentHash]]),
        },
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: makeStubbedCommits([['#1 feat: past feature', pastHash]]),
        },
      ]);

      tree.writeJson('.meta/changelog-overrides.json', {
        aabbcc12: { audience: 'skip' }, // past-release commit — must NOT be stale
        deadbeef: { audience: 'skip' }, // unreachable — must be flagged stale
      });

      const result = await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: singlePackage,
        loadValidatedConfig: () =>
          Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
      });

      // Bug regression gate: aabbcc12 must not appear in any warning.
      expect(result.message).not.toContain('aabbcc12');
      // The genuinely-orphaned key must still be flagged.
      expect(result.message).toContain('deadbeef');
      expect(result.exitCode).toBe(1);
      // The single-package scope reads the configured tag prefix over all paths.
      expect(mockedEnumerateReleaseWindows).toHaveBeenCalledWith({
        tagPrefixes: ['v'],
        unreleasedTag: 'unreleased',
      });
    });
  });

  // Monorepo wiring: pin the per-workspace and project-tier `buildEntries` arguments so a
  // future refactor that drops legacy identities, narrows the project path-union, or otherwise
  // diverges from `buildWorkspaceEntries` / `planProjectChangelogs` in the prepare path fails
  // here rather than silently producing wrong stale-key reports.
  describe('buildMonorepoInputs (monorepo wiring)', () => {
    let tree: TempTree;

    beforeEach(() => {
      tree = disposeOnTestFinished(createTempTree({}, { prefix: 'validate-overrides-mono-' }));
      tree.writeAll({
        // Root package.json — required when the user config declares a `project` block.
        'package.json': JSON.stringify({ name: 'mono-root', version: '1.0.0' }),
        // Workspace `foo` with a legacy npm name `old-foo`.
        'packages/foo/package.json': JSON.stringify({ name: 'foo' }),
        // Workspace `bar` with a scoped npm name (strips to `bar` for tag-prefix derivation).
        'packages/bar/package.json': JSON.stringify({ name: '@scope/bar' }),
      });
      disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
    });

    it('passes per-workspace tag prefixes (with legacy identities) and the project tier prefix with the union of workspace paths', async () => {
      const calls: GenerateChangelogOptions[] = [];

      await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: () => resolvedPackages(['packages/foo', 'packages/bar']),
        loadValidatedConfig: () =>
          Promise.resolve({
            status: 'ok',
            configFilePath: '.config/release-kit.config.ts',
            warnings: [],
            config: {
              workspaces: [{ dir: 'foo', legacyIdentities: [{ name: 'old-foo', tagPrefix: 'old-foo-v' }] }],
              project: { tagPrefix: 'mono-v' },
            },
          }),
        buildEntries: (_config, options) => {
          calls.push(options);
          return [];
        },
        validate: () => ({ errors: [], warnings: [] }),
      });

      // Three invocations: foo workspace, bar workspace, project-tier.
      expect(calls).toHaveLength(3);

      // foo: the union of derived + legacy prefixes, over the workspace glob.
      expect(calls[0]).toStrictEqual({
        tagPrefixes: ['foo-v', 'old-foo-v'],
        paths: ['packages/foo/**'],
      });

      // bar: single derived prefix (no legacy identities), over its workspace glob.
      expect(calls[1]).toStrictEqual({
        tagPrefixes: ['bar-v'],
        paths: ['packages/bar/**'],
      });

      // Project tier: the project prefix; paths default to the union of workspace globs.
      expect(calls[2]).toStrictEqual({
        tagPrefixes: ['mono-v'],
        paths: ['packages/foo/**', 'packages/bar/**'],
      });
    });

    it('scopes the project tier to a declared project.paths', async () => {
      const calls: GenerateChangelogOptions[] = [];

      await validateOverridesCommand(RICH_STYLES, undefined, {
        discoverWorkspaces: () => resolvedPackages(['packages/foo', 'packages/bar']),
        loadValidatedConfig: () =>
          Promise.resolve({
            status: 'ok',
            configFilePath: '.config/release-kit.config.ts',
            warnings: [],
            config: { project: { paths: ['**'], tagPrefix: 'mono-v' } },
          }),
        buildEntries: (_config, options) => {
          calls.push(options);
          return [];
        },
        validate: () => ({ errors: [], warnings: [] }),
      });

      expect(calls[2]).toStrictEqual({
        tagPrefixes: ['mono-v'],
        paths: ['**'],
      });
    });
  });
});
