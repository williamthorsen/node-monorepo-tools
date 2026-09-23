import { describe, expect, it } from 'vitest';

import { buildChangelogEntries, readReleaseHistory } from '../buildChangelogEntries.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';
import type { ChangelogEntry } from '../types.ts';

const CONFIG = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG } };

describe(buildChangelogEntries, () => {
  it('builds entries from the commits that the history lists for a bare directory path', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Add the handler', { 'aws/handler.ts': 'export const handler = 1;\n' });
    repo.tag('aws-v1.0.0');
    const fixHash = repo.commit('#2 fix: Retry the upload', { 'aws/upload.ts': 'export const upload = 2;\n' });
    repo.commit('#3 feat: Add an unrelated tool', { 'tools/other.ts': 'export const other = 3;\n' });

    const history = readReleaseHistory(CONFIG, { tagPrefixes: ['aws-v'], paths: ['aws'] });
    const { entries } = buildChangelogEntries(CONFIG, 'aws-v1.1.0', { tagPrefixes: ['aws-v'], paths: ['aws'] });

    expect(history.unreleased.commits.map((commit) => commit.hash)).toStrictEqual([fixHash]);
    expect(summarize(entries)).toStrictEqual([
      { version: '1.1.0', descriptions: ['Retry the upload'] },
      { version: '1.0.0', descriptions: ['Add the handler'] },
    ]);
  });

  it("carries each commit's body and full hash into its item", () => {
    const repo = scaffoldGitRepo();
    const hash = repo.commit('#1 feat: Add the parser\n\nParses the manifest.\n\nSigned-off-by: A <a@example.com>');

    const { entries } = buildChangelogEntries(CONFIG, 'v1.0.0', { tagPrefixes: ['v'] });

    expect(entries[0]?.sections[0]?.items).toStrictEqual([
      { description: 'Add the parser', body: 'Parses the manifest.', hash },
    ]);
  });

  it("builds one item per entry from a real commit's change-record block", () => {
    const repo = scaffoldGitRepo();
    const hash = repo.commit(
      [
        '#867 release-kit|feat: Read the change record (#42)',
        '',
        'Lede paragraph.',
        '',
        '```change-record',
        'pr_number: 42',
        'entries:',
        '  - type: feat',
        '    scopes: [release-kit]',
        '    breaking: false',
        '    text: Adds the reader.',
        '  - type: fix',
        '    text: Corrects the guard.',
        '```',
      ].join('\n'),
    );

    const { entries } = buildChangelogEntries(CONFIG, 'v1.0.0', { tagPrefixes: ['v'] });

    expect(entries[0]?.sections.map((section) => section.items)).toStrictEqual([
      [{ description: 'Adds the reader. (#42)', hash, entry: 1 }],
      [{ description: 'Corrects the guard. (#42)', hash, entry: 2 }],
    ]);
  });
});

describe(readReleaseHistory, () => {
  it('returns the baseline tag and the commits above it, newest first', () => {
    const repo = scaffoldGitRepo();
    seedTaggedBaseline(repo);

    const history = readHistory(['arrays-v']);

    expect(history.previousTag).toBe('arrays-v1.0.0');
    expect(subjects(history)).toStrictEqual(['#3 fix: Newest', '#2 feat: Newer']);
  });

  it('derives the bump from the unreleased items alone', () => {
    const repo = scaffoldGitRepo();
    seedTaggedBaseline(repo);

    expect(readHistory(['arrays-v']).unreleased.bump).toBe('minor');
  });

  it('returns no commits and no bump when HEAD sits on the baseline tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');

    const history = readHistory(['arrays-v']);

    expect(history.previousTag).toBe('arrays-v1.0.0');
    expect(history.unreleased.commits).toStrictEqual([]);
    expect(history.unreleased.bump).toBeUndefined();
  });

  it('returns every commit and no tag when no matching tag exists', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: First', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('other-v1.0.0');
    repo.commit('#2 fix: Second', { 'src/second.ts': 'export const second = 2;\n' });

    const history = readHistory(['arrays-v']);

    expect(history.previousTag).toBeUndefined();
    expect(subjects(history)).toStrictEqual(['#2 fix: Second', '#1 feat: First']);
  });

  it('names the newest matching tag when several are reachable', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: First', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('#2 feat: Second', { 'src/second.ts': 'export const second = 2;\n' });
    repo.tag('arrays-v1.1.0');
    repo.commit('#3 fix: Third', { 'src/third.ts': 'export const third = 3;\n' });

    const history = readHistory(['arrays-v']);

    expect(history.previousTag).toBe('arrays-v1.1.0');
    expect(subjects(history)).toStrictEqual(['#3 fix: Third']);
  });

  it('reports a branch commit merged after the baseline tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 internal: Base', { 'src/base.ts': 'export const base = 0;\n' }, { date: '2026-01-01T00:00:00Z' });
    repo.git('checkout', '--quiet', '-b', 'feat');
    repo.commit(
      '#2 feat: Branch work',
      { 'src/branch.ts': 'export const branch = 1;\n' },
      { date: '2026-01-02T00:00:00Z' },
    );
    repo.git('checkout', '--quiet', 'main');
    repo.commit('#3 fix: Mainline', { 'src/main.ts': 'export const main = 2;\n' }, { date: '2026-01-03T00:00:00Z' });
    repo.tag('arrays-v1.0.0');
    repo.merge('feat', 'Merge feat', { date: '2026-01-04T00:00:00Z' });

    const history = readHistory(['arrays-v']);

    // The branch commit is older by commit date than the tag, and the tag does not contain it.
    expect(history.previousTag).toBe('arrays-v1.0.0');
    expect(subjects(history)).toStrictEqual(['Merge feat', '#2 feat: Branch work']);
    expect(history.unreleased.bump).toBe('minor');
  });

  it('searches every listed prefix as a union', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: First', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('core-v0.2.7');
    repo.commit('#2 fix: Second', { 'src/second.ts': 'export const second = 2;\n' });

    const history = readHistory(['nmr-core-v', 'core-v']);

    expect(history.previousTag).toBe('core-v0.2.7');
    expect(subjects(history)).toStrictEqual(['#2 fix: Second']);
  });

  it('filters out release commits', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('#2 feat: Add feature', { 'src/feature.ts': 'export const feature = 1;\n' });
    repo.commit('release: arrays-v1.1.0 strings-v2.0.1', { 'CHANGELOG.md': '# Changelog\n' });
    repo.commit('#3 fix: Patch bug', { 'src/patch.ts': 'export const patch = 1;\n' });

    expect(subjects(readHistory(['arrays-v']))).toStrictEqual(['#3 fix: Patch bug', '#2 feat: Add feature']);
  });

  it('restricts the commits to the given paths', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('#2 feat: In scope', { 'packages/arrays/index.ts': 'export const a = 1;\n' });
    repo.commit('#3 feat: Out of scope', { 'packages/strings/index.ts': 'export const s = 1;\n' });

    expect(subjects(readHistory(['arrays-v'], ['packages/arrays/**']))).toStrictEqual(['#2 feat: In scope']);
  });

  it('carries the body of a commit that has one', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Add a thing\n\nAdds a thing.', { 'src/thing.ts': 'export const thing = 1;\n' });

    const [commit] = readHistory(['arrays-v']).unreleased.commits;

    expect(commit?.subject).toBe('#1 feat: Add a thing');
    expect(commit?.body).toBe('Adds a thing.');
    expect(commit?.message).toBe('#1 feat: Add a thing\n\nAdds a thing.');
  });

  it('throws when the prefix array is empty', () => {
    scaffoldGitRepo();

    expect(() => readHistory([])).toThrow('enumerateReleaseWindows: tagPrefixes must contain at least one entry');
  });
});

// region | Helpers

/** Reads the history of the scaffolded repo under the default configuration. */
function readHistory(tagPrefixes: readonly string[], paths?: readonly string[]): ReturnType<typeof readReleaseHistory> {
  return readReleaseHistory(CONFIG, { tagPrefixes, ...(paths !== undefined && { paths }) });
}

/** Builds a tagged baseline with two commits above it. */
function seedTaggedBaseline(repo: GitRepoFixture): void {
  repo.commit('#1 feat: Released', { 'src/released.ts': 'export const released = 1;\n' });
  repo.tag('arrays-v1.0.0');
  repo.commit('#2 feat: Newer', { 'src/newer.ts': 'export const newer = 2;\n' });
  repo.commit('#3 fix: Newest', { 'src/newest.ts': 'export const newest = 3;\n' });
}

/** Lists the subjects of the unreleased commits. */
function subjects(history: ReturnType<typeof readReleaseHistory>): string[] {
  return history.unreleased.commits.map((commit) => commit.subject);
}

/** Reduces entries to their versions and item descriptions. */
function summarize(entries: readonly ChangelogEntry[]): Array<{ version: string; descriptions: string[] }> {
  return entries.map((entry) => ({
    version: entry.version,
    descriptions: entry.sections.flatMap((section) => section.items.map((item) => item.description)),
  }));
}

// endregion | Helpers
