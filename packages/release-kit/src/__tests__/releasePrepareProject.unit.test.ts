import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockBuildChangelogEntries = vi.hoisted(() => vi.fn());
const mockWriteChangelogJson = vi.hoisted(() => vi.fn());
const mockWriteReleaseNotesPreviews = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  copyFileSync: mockCopyFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  mkdtempSync: mockMkdtempSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: () => 'cliff.toml',
}));

vi.mock('../buildChangelogEntries.ts', () => ({
  buildChangelogEntries: mockBuildChangelogEntries,
}));

vi.mock('../changelogJsonFile.ts', () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  writeChangelogJson: mockWriteChangelogJson,
  upsertChangelogJson: vi.fn(),
}));

vi.mock('../writeReleaseNotesPreviews.ts', () => ({
  writeReleaseNotesPreviews: mockWriteReleaseNotesPreviews,
}));

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import { releasePrepareProject } from '../releasePrepareProject.ts';
import type { MonorepoReleaseConfig, WorkspaceConfig } from '../types.ts';

function makeWorkspace(overrides: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, 'dir'>): WorkspaceConfig {
  const { dir } = overrides;
  return {
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}/**`],
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    workspaces: [makeWorkspace({ dir: 'arrays' }), makeWorkspace({ dir: 'strings' })],
    workTypes: { feat: { header: 'Features' }, fix: { header: 'Bug fixes' } },
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    project: { tagPrefix: 'v' },
    ...overrides,
  };
}

/** Default git mock: legacy v0.9.0 baseline tag, one feat commit since. */
function setupDefaultGit(): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'describe') {
      return 'v0.9.0\n';
    }
    if (cmd === 'git' && args[0] === 'log') {
      return 'feat: ship projectabc123';
    }
    // git-cliff invocation: returns nothing meaningful in this orchestrator's path (we
    // only use the args).
    return '';
  });
}

describe(releasePrepareProject, () => {
  beforeEach(() => {
    mockBuildChangelogEntries.mockReturnValue([]);
    mockWriteChangelogJson.mockImplementation((filePath: string) => filePath);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '0.9.0' }));
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockMkdtempSync.mockReset();
    mockRmSync.mockReset();
    mockCopyFileSync.mockReset();
    mockBuildChangelogEntries.mockReset();
    mockWriteChangelogJson.mockReset();
    mockWriteReleaseNotesPreviews.mockReset();
  });

  it('returns a structured skipped result when no commits since the last project tag and no force', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') return '';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'skipped') throw new Error('expected skipped');
    expect(result.commitCount).toBe(0);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.skipReason).toBe('No commits since v0.9.0. Pass --force to release at patch. Skipping.');
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
  });

  it('returns a structured skipped result when commits exist but none are bump-worthy and no force', () => {
    // Project pipeline matches the per-workspace pipeline: with commits but no bump-worthy
    // parsed type and no --force, the project skips with the "No bump-worthy commits" reason.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      // 'chore' is not in the test workTypes (only feat, fix), so this commit is unparseable.
      if (cmd === 'git' && args[0] === 'log') return 'chore: update deps\u001Fabc123';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'skipped') throw new Error('expected skipped');
    expect(result.commitCount).toBe(1);
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.parsedCommitCount).toBe(0);
    expect(result.skipReason).toContain('No bump-worthy commits since v0.9.0');
    expect(result.skipReason).toContain('Pass --force to release at patch');
    expect(result.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
  });

  it('falls back to patch when --force is set with no commits (no --bump)', () => {
    // Row 3 of the behavioral matrix: `--force` alone with no commits is now valid;
    // the project releases at patch. Today this combination was rejected at the CLI.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') return '';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false, force: true },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(0);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.bumpOverride).toBeUndefined();
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('falls back to patch when --force is set with commits-but-no-bump-worthy', () => {
    // Row 11 of the behavioral matrix: `--force` alone with non-bump-worthy commits releases
    // at patch (rather than skipping).
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') return 'chore: update deps\u001Fabc123';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false, force: true },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(1);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('skips when --bump=X alone is set with commits-but-no-bump-worthy (level chooser, not trigger)', () => {
    // Row 10 of the behavioral matrix: `--bump=X` is now a pure level chooser. With
    // commits that don't parse to a bump-worthy type, the project skips even when
    // `--bump=X` is set without `--force`.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') return 'chore: update deps\u001Fabc123';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false, bumpOverride: 'minor' },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'skipped') throw new Error('expected skipped');
    expect(result.skipReason).toContain('No bump-worthy commits since v0.9.0');
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
  });

  it('bumps root package.json, writes ./CHANGELOG.md, appends tag, and appends modified files', () => {
    setupDefaultGit();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.tag).toBe('v0.10.0');
    expect(result.releaseType).toBe('minor');
    expect(result.currentVersion).toBe('0.9.0');
    expect(result.newVersion).toBe('0.10.0');
    expect(result.changelogFiles).toContain('./CHANGELOG.md');

    expect(tags).toStrictEqual(['v0.10.0']);
    expect(modifiedFiles).toContain('./package.json');
    expect(modifiedFiles).toContain('./CHANGELOG.md');

    // Root package.json was written with the new version.
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      './package.json',
      expect.stringContaining('"version": "0.10.0"'),
      'utf8',
    );

    // git-cliff invoked with tag-pattern derived from project tagPrefix and contributing paths.
    const cliffCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
    );
    expect(cliffCall).toBeDefined();
    const cliffArgs = cliffCall?.[1];
    expect(cliffArgs).toContain('--tag-pattern');
    expect(cliffArgs).toContain('v[0-9].*');
    expect(cliffArgs).toContain('--include-path');
    expect(cliffArgs).toContain('packages/arrays/**');
    expect(cliffArgs).toContain('packages/strings/**');
    expect(cliffArgs).toContain('--output');
    expect(cliffArgs).toContain('./CHANGELOG.md');
    expect(cliffArgs).toContain('--tag');
    expect(cliffArgs).toContain('v0.10.0');
  });

  it('omits paths of workspaces absent from config.workspaces (e.g., excluded by discovery or --only)', () => {
    setupDefaultGit();
    const config = makeConfig({
      workspaces: [makeWorkspace({ dir: 'arrays' })],
    });

    releasePrepareProject({
      config,
      options: { dryRun: false },
      modifiedFiles: [],
      tags: [],
    });

    const cliffCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
    );
    const cliffArgs = cliffCall?.[1] ?? [];
    expect(cliffArgs).toContain('packages/arrays/**');
    expect(cliffArgs).not.toContain('packages/legacy/**');
  });

  it('uses bumpOverride instead of commit-derived bump type', () => {
    setupDefaultGit();
    // Use a 1.x baseline so the major bump is not collapsed by the pre-1.0 rule in `bumpVersion`.
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '1.5.2' }));
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false, bumpOverride: 'major' },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.releaseType).toBe('major');
    expect(result.bumpOverride).toBe('major');
    expect(result.newVersion).toBe('2.0.0');
    expect(tags).toStrictEqual(['v2.0.0']);
  });

  it('runs with no commits when --force is set with --bump', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') return '';
      return '';
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false, force: true, bumpOverride: 'patch' },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('does not write any files in dry-run mode', () => {
    setupDefaultGit();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: true },
      modifiedFiles,
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.tag).toBe('v0.10.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    // The Markdown CHANGELOG path: git-cliff itself is invoked through `generateChangelog`,
    // which short-circuits in dry-run, so no `npx git-cliff` call appears here. The structured
    // JSON path is exercised in the dedicated tests below.
    expect(
      mockExecFileSync.mock.calls.find(
        (call) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
      ),
    ).toBeUndefined();
  });

  it('writes the root changelog.json without invoking the upsert path (project-stage no-merge)', () => {
    // Pin: the project stage uses writeChangelogJson (overwrite, no read-merge), not
    // upsertChangelogJson. This is the structural fix for #316 W4: by removing the read,
    // there is no parse-failure path to silently discard entries.
    setupDefaultGit();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    const modifiedFiles: string[] = [];

    releasePrepareProject({
      config,
      options: { dryRun: false },
      modifiedFiles: modifiedFiles,
      tags: [],
    });

    expect(mockBuildChangelogEntries).toHaveBeenCalledTimes(1);
    expect(mockWriteChangelogJson).toHaveBeenCalledTimes(1);
    expect(mockWriteChangelogJson).toHaveBeenCalledWith('./.meta/changelog.json', expect.any(Array));
    expect(modifiedFiles).toContain('./.meta/changelog.json');
  });

  it('does not warn or short-circuit when the existing root changelog.json is unparseable', () => {
    // The project stage no longer reads the existing root changelog.json: an unparseable
    // existing file produces no warning and does not affect output. Acceptance criterion
    // from ticket #324: "an unparseable existing root `changelog.json` does NOT cause a
    // warning or affect output (because it's not read)".
    setupDefaultGit();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    // Existing file present and unparseable; with the project stage's no-read design, this
    // never reaches the parse path.
    mockExistsSync.mockImplementation((path: string) => path.endsWith('/.meta/changelog.json'));
    mockReadFileSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('/.meta/changelog.json')) return '{invalid json';
      return JSON.stringify({ name: 'root', version: '0.9.0' });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    releasePrepareProject({
      config,
      options: { dryRun: false },
      modifiedFiles: [],
      tags: [],
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockWriteChangelogJson).toHaveBeenCalledTimes(1);
  });

  it('invokes buildChangelogEntries even in dry-run mode (intentional behavioral change)', () => {
    // Pin: under the layered redesign, buildChangelogEntries always runs and dryRun governs
    // only the file write. This is the deliberate change called out in Task 1 of the plan —
    // dry-run now exercises the full git-cliff toolchain.
    setupDefaultGit();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    const modifiedFiles: string[] = [];

    releasePrepareProject({
      config,
      options: { dryRun: true },
      modifiedFiles,
      tags: [],
    });

    expect(mockBuildChangelogEntries).toHaveBeenCalledTimes(1);
    expect(mockWriteChangelogJson).not.toHaveBeenCalled();
    expect(modifiedFiles).toContain('./.meta/changelog.json');
  });

  it('emits release-notes previews when --with-release-notes is set and changelogJson.enabled', () => {
    setupDefaultGit();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    releasePrepareProject({
      config,
      options: { dryRun: false, withReleaseNotes: true },
      modifiedFiles,
      tags,
    });

    expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledTimes(1);
    expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '.',
        tag: 'v0.10.0',
        dryRun: false,
        changelogJsonPath: './.meta/changelog.json',
      }),
    );
  });

  it('does not emit release-notes previews when the flag is omitted', () => {
    setupDefaultGit();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });

    releasePrepareProject({
      config,
      options: { dryRun: false },
      modifiedFiles: [],
      tags: [],
    });

    expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it('first-run: legacy v0.9.0 baseline produces a bump derived from the contributing-paths commits', () => {
    // findLatestTag returns the legacy `v0.9.0` tag; commits since are the source of truth for
    // the project bump. The legacy tag shape is the same as the project tagPrefix `v`.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') return 'v0.9.0\n';
      if (cmd === 'git' && args[0] === 'log') {
        return 'fix: patch arrays bugabc\nfeat: ship strings helperdef';
      }
      return '';
    });
    const tags: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { dryRun: false },
      modifiedFiles: [],
      tags,
    });

    if (result.status !== 'released') throw new Error('expected released');
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.commitCount).toBe(2);
    expect(result.releaseType).toBe('minor'); // feat triggers minor over fix's patch
    expect(result.newVersion).toBe('0.10.0');
    expect(tags).toStrictEqual(['v0.10.0']);
  });

  it('throws when called without a project block', () => {
    const config = makeConfig();
    delete config.project;
    expect(() =>
      releasePrepareProject({
        config,
        options: { dryRun: false },
        modifiedFiles: [],
        tags: [],
      }),
    ).toThrow(/without a configured project block/);
  });
});
