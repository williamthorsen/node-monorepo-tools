import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGitCliff } from '../runGitCliff.ts';
import type { ChangelogEntry } from '../types.ts';
import { formatValidateOverridesResult, validateOverridesCommand } from '../validateOverridesCommand.ts';

// Stub `runGitCliff` so the near-integration block can exercise the real
// `validateOverridesCommand → buildChangelogEntries → validateAllChangelogOverrides` pipeline
// without requiring git-cliff on PATH. Other tests in this file inject `buildEntries` directly,
// so they never reach the stubbed call site.
vi.mock('../runGitCliff.ts', () => ({
  runGitCliff: vi.fn(() => '[]'),
}));

const mockedRunGitCliff = vi.mocked(runGitCliff);

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
    const result = formatValidateOverridesResult({ errors: [], warnings: [] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/valid/);
  });

  it('returns exit 1 with only warnings rendered (zero-count error category is omitted)', () => {
    const result = formatValidateOverridesResult({
      errors: [],
      warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale99' did not match"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('Found 1 warning:');
    expect(result.message).not.toContain('error');
    expect(result.message).toContain('stale99');
    expect(result.message).not.toContain('❌');
    expect(result.message).toContain('⚠️');
  });

  it('omits the warning category from the summary when only errors are present', () => {
    const result = formatValidateOverridesResult({
      errors: ["file.json: Override key 'abc' is ambiguous: matches multiple commits"],
      warnings: [],
    });
    expect(result.message).toContain('Found 1 error:');
    expect(result.message).not.toContain('warning');
  });

  it('returns exit 2 when any error is present, regardless of warnings', () => {
    const result = formatValidateOverridesResult({
      errors: [".meta/changelog-overrides.json: Override key 'abc' is ambiguous: matches multiple commits"],
      warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale' did not match"],
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('ambiguous');
    expect(result.message).toContain('stale');
  });

  it('pluralizes the summary line', () => {
    const result = formatValidateOverridesResult({
      errors: ['file.json: error a', 'file.json: error b'],
      warnings: ['file.json: warn a'],
    });
    expect(result.message).toContain('Found 2 errors and 1 warning');
  });
});

describe(validateOverridesCommand, () => {
  it('returns exit 0 in a single-package layout with no overrides', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('returns exit 1 when validation surfaces only warnings', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: [], warnings: ['file.json: stale key'] }),
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns exit 2 when validation surfaces errors', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      buildEntries: () => entriesFromHashes([]),
      validate: () => ({ errors: ['file.json: ambiguous'], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('returns exit 2 with a config-load failure message', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.reject(new Error('boom')),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('Error loading config');
    expect(result.message).toContain('boom');
  });

  it('returns exit 2 with an Invalid config message when the loaded config fails validation', async () => {
    // `validateConfig` rejects non-record top-level values with "Config must be an object".
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(42),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('Invalid config');
  });

  it('passes a project-only scope to validate in single-package mode', async () => {
    let received: { workspaces: number; projectHashes: number } | undefined;
    await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      buildEntries: () => entriesFromHashes(['hash1', 'hash2']),
      validate: (inputs) => {
        received = {
          workspaces: inputs.workspaces?.length ?? 0,
          projectHashes: inputs.project?.hashes?.length ?? 0,
        };
        return { errors: [], warnings: [] };
      },
    });
    expect(received).toStrictEqual({ workspaces: 0, projectHashes: 2 });
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
    await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      buildEntries: () =>
        entriesFromReleases([
          { version: '1.0.0', hashes: ['aabbcc1234567890aabbcc1234567890aabbcc12'] },
          { version: '2.0.0', hashes: ['ddeeff5678901234ddeeff5678901234ddeeff56'] },
          { version: 'validate-only', hashes: ['9988aabbccddeeff9988aabbccddeeff9988aabb'] },
        ]),
      validate: (inputs) => {
        capturedHashes = inputs.project?.hashes ?? [];
        return { errors: [], warnings: [] };
      },
    });
    expect(capturedHashes).toEqual([
      'aabbcc1234567890aabbcc1234567890aabbcc12',
      'ddeeff5678901234ddeeff5678901234ddeeff56',
      '9988aabbccddeeff9988aabbccddeeff9988aabb',
    ]);
  });

  describe('against the real validator (writes a temp override file)', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      tempDir = mkdtempSync(path.join(tmpdir(), 'validate-overrides-'));
      mkdirSync(path.join(tempDir, '.meta'), { recursive: true });
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });

    function writeOverrides(overrides: Record<string, unknown>): void {
      writeFileSync(path.join(tempDir, '.meta', 'changelog-overrides.json'), JSON.stringify(overrides, null, 2));
    }

    it('does NOT flag an override targeting a past-release commit as stale', async () => {
      const pastHash = 'aabbcc1234567890aabbcc1234567890aabbcc12';
      const unreleasedHash = '9988aabbccddeeff9988aabbccddeeff9988aabb';
      writeOverrides({ aabbcc12: { audience: 'skip' } });

      const result = await validateOverridesCommand({
        discoverWorkspaces: () => Promise.resolve(undefined),
        loadConfig: () => Promise.resolve(undefined),
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

      const result = await validateOverridesCommand({
        discoverWorkspaces: () => Promise.resolve(undefined),
        loadConfig: () => Promise.resolve(undefined),
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

      const result = await validateOverridesCommand({
        discoverWorkspaces: () => Promise.resolve(undefined),
        loadConfig: () => Promise.resolve(undefined),
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

  describe('near-integration: full pipeline with mocked runGitCliff', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      tempDir = mkdtempSync(path.join(tmpdir(), 'validate-overrides-int-'));
      mkdirSync(path.join(tempDir, '.meta'), { recursive: true });
      process.chdir(tempDir);
      mockedRunGitCliff.mockReset();
      mockedRunGitCliff.mockReturnValue('[]');
    });

    afterEach(() => {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('exercises real validateOverridesCommand → buildChangelogEntries → validator with a multi-release cliff context (#398)', async () => {
      // Canned `git-cliff --context` output simulating two releases plus the unreleased range.
      // The past-release commit `aabbcc12…` is what regressed prior to the fix: the narrow
      // `git log <latestTag>..HEAD` universe excluded it, causing a false-positive stale warning.
      const pastHash = 'aabbcc1234567890aabbcc1234567890aabbcc12';
      const currentHash = 'ddeeff5678901234ddeeff5678901234ddeeff56';
      const unreleasedHash = '9988aabbccddeeff9988aabbccddeeff9988aabb';
      mockedRunGitCliff.mockReturnValue(
        JSON.stringify([
          {
            version: 'v1.0.0',
            timestamp: 1_700_000_000,
            commits: [{ id: pastHash, message: 'feat: past feature', group: 'Features' }],
          },
          {
            version: 'v2.0.0',
            timestamp: 1_710_000_000,
            commits: [{ id: currentHash, message: 'feat: current feature', group: 'Features' }],
          },
          {
            version: 'validate-only',
            commits: [{ id: unreleasedHash, message: 'feat: unreleased feature', group: 'Features' }],
          },
        ]),
      );

      writeFileSync(
        path.join(tempDir, '.meta', 'changelog-overrides.json'),
        JSON.stringify({
          aabbcc12: { audience: 'skip' }, // past-release commit — must NOT be stale
          deadbeef: { audience: 'skip' }, // unreachable — must be flagged stale
        }),
      );

      const result = await validateOverridesCommand({
        discoverWorkspaces: () => Promise.resolve(undefined),
        loadConfig: () => Promise.resolve(undefined),
      });

      // Bug regression gate: aabbcc12 must not appear in any warning.
      expect(result.message).not.toContain('aabbcc12');
      // The genuinely-orphaned key must still be flagged.
      expect(result.message).toContain('deadbeef');
      expect(result.exitCode).toBe(1);
      // Confirm the production code path actually invoked cliff (proves the pipeline ran).
      expect(mockedRunGitCliff).toHaveBeenCalled();
    });
  });

  // Monorepo wiring: pin the per-workspace and project-tier `buildEntries` arguments so a
  // future refactor that drops legacy identities, narrows the project path-union, or otherwise
  // diverges from `releasePrepareMono.ts:722-723` / `releasePrepareProject.ts:262-266` fails
  // here rather than silently producing wrong stale-key reports.
  describe('buildMonorepoInputs (monorepo wiring)', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      tempDir = mkdtempSync(path.join(tmpdir(), 'validate-overrides-mono-'));
      // Root package.json — required when the user config declares a `project` block.
      writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'mono-root', version: '1.0.0' }));
      // Workspace `foo` with a legacy npm name `old-foo`.
      mkdirSync(path.join(tempDir, 'packages/foo'), { recursive: true });
      writeFileSync(path.join(tempDir, 'packages/foo/package.json'), JSON.stringify({ name: 'foo' }));
      // Workspace `bar` with a scoped npm name (strips to `bar` for tag-prefix derivation).
      mkdirSync(path.join(tempDir, 'packages/bar'), { recursive: true });
      writeFileSync(path.join(tempDir, 'packages/bar/package.json'), JSON.stringify({ name: '@scope/bar' }));
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('passes per-workspace tagPattern (with legacy identities) and project-tier tagPattern with the union of workspace paths', async () => {
      const calls: { tagPattern: string | undefined; includePaths: readonly string[] | undefined }[] = [];

      await validateOverridesCommand({
        discoverWorkspaces: () => Promise.resolve(['packages/foo', 'packages/bar']),
        loadConfig: () =>
          Promise.resolve({
            workspaces: [{ dir: 'foo', legacyIdentities: [{ name: 'old-foo', tagPrefix: 'old-foo-v' }] }],
            project: { tagPrefix: 'mono-v' },
          }),
        buildEntries: (_config, tagPattern, includePaths) => {
          calls.push({ tagPattern, includePaths });
          return [];
        },
        validate: () => ({ errors: [], warnings: [] }),
      });

      // Three invocations: foo workspace, bar workspace, project-tier.
      expect(calls).toHaveLength(3);

      // foo: workspace tagPattern is the union of derived + legacy prefixes; includePaths is the workspace glob.
      expect(calls[0]).toEqual({
        tagPattern: '(foo-v|old-foo-v)[0-9].*',
        includePaths: ['packages/foo/**'],
      });

      // bar: single derived prefix (no legacy identities); includePaths is its workspace glob.
      expect(calls[1]).toEqual({
        tagPattern: 'bar-v[0-9].*',
        includePaths: ['packages/bar/**'],
      });

      // Project tier: project tagPattern; includePaths is the union of workspace globs.
      expect(calls[2]).toEqual({
        tagPattern: 'mono-v[0-9].*',
        includePaths: ['packages/foo/**', 'packages/bar/**'],
      });
    });
  });
});
