import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';
import type { RawCommit, ReleaseWindow } from '../enumerateReleaseWindows.ts';
import { matchesAudience, renderReleaseNotesSingle } from '../renderReleaseNotes.ts';
import type { ChangelogEntry, ChangelogJsonConfig, ReleaseConfig } from '../types.ts';

// Mock the enumerator so the test exercises buildChangelogEntries' transformation logic
// without reading git history. `buildChangelogEntries.tool.test.ts` covers the real reader.
const mockEnumerateReleaseWindows = vi.hoisted(() => vi.fn<() => ReleaseWindow[]>());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('../enumerateReleaseWindows.ts'), () => ({
  enumerateReleaseWindows: mockEnumerateReleaseWindows,
}));

vi.mock(import('node:fs'), () => ({
  writeFileSync: mockWriteFileSync,
}));

import { buildChangelogEntries } from '../buildChangelogEntries.ts';

const defaultChangelogJsonConfig: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: ['CI', 'Dependencies', 'Internal', 'Refactoring', 'Tests', 'Tooling'],
};

const OPTIONS = { tagPrefixes: ['v'] };

function makeConfig(overrides?: Partial<ChangelogJsonConfig>): Pick<ReleaseConfig, 'changelogJson'> {
  return {
    changelogJson: { ...defaultChangelogJsonConfig, ...overrides },
  };
}

describe(buildChangelogEntries, () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('transforms release windows into a ChangelogEntry array', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v1.0.0', ['#1 feat: Add new feature', '#2 fix: Fix a bug', '#3 ci: Update pipeline']),
    ]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(entries[0]?.sections).toHaveLength(3);

    const features = entries[0]?.sections.find((s) => s.title === '🎉 Features');
    expect(features?.audience).toBe('all');
    expect(features?.items[0]?.description).toBe('Add new feature');

    const ci = entries[0]?.sections.find((s) => s.title === '👷 CI');
    expect(ci?.audience).toBe('dev');
  });

  it('emits one entry per window, newest first, dated from the window timestamp', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v1.1.0', ['#2 feat: Unreleased'], 1_710_000_000),
      makeWindow('v1.0.0', ['#1 feat: Released']),
    ]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v1.1.0', OPTIONS);

    expect(entries.map(({ version, date }) => ({ version, date }))).toStrictEqual([
      { version: '1.1.0', date: '2024-03-09' },
      { version: '1.0.0', date: '2023-11-14' },
    ]);
  });

  it('tags sections with correct audience based on devOnlySections', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v2.0.0', ['#1 feat: Feature', '#2 deps: Bump deps', '#3 tests: Add test', '#4 fix: Bug fix']),
    ]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v2.0.0', OPTIONS);

    const audiences = Object.fromEntries(entries[0]?.sections.map((s) => [s.title, s.audience]) ?? []);
    expect(audiences).toStrictEqual({
      '🎉 Features': 'all',
      '🐛 Bug fixes': 'all',
      '🧪 Tests': 'dev',
      '📦 Dependencies': 'dev',
    });
  });

  it('classifies emoji-prefixed section titles against bare-name devOnlySections overrides', () => {
    // A consumer override written as `devOnlySections: ['Internal features']` (bare) must keep
    // matching the emoji-prefixed default title `'🏗️ Internal features'`, so upgrading does not
    // silently reclassify their sections.
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v1.0.0', ['#1 feat: User-facing thing', '#2 internal: Plumbing change', '#3 deps: Bump deps']),
    ]);

    const { entries } = buildChangelogEntries(
      makeConfig({ devOnlySections: ['Internal features', 'Dependencies'] }),
      'v1.0.0',
      OPTIONS,
    );

    const audiences = Object.fromEntries(entries[0]?.sections.map((s) => [s.title, s.audience]) ?? []);
    expect(audiences).toStrictEqual({
      '🎉 Features': 'all',
      '🏗️ Internal features': 'dev',
      '📦 Dependencies': 'dev',
    });
  });

  it('emits sections in canonical tier-then-row order regardless of commit encounter order', () => {
    // A window lists its commits oldest first, so `transformReleases` would otherwise insert
    // sections in first-seen order. `changelog.json` sections inherit canonical order — verify
    // directly that an out-of-order window still produces canonical-order output.
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v3.0.0', [
        '#1 docs: Update guide',
        '#2 ci: Pin runner',
        '#3 internal: Refactor helper',
        '#4 fix: Patch leak',
        '#5 feat: Add widget',
      ]),
    ]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v3.0.0', OPTIONS);

    const titles = entries[0]?.sections.map((s) => s.title);
    expect(titles).toStrictEqual(['🎉 Features', '🐛 Bug fixes', '🏗️ Internal features', '👷 CI', '📚 Documentation']);
  });

  it('preserves the full first line when no colon-space pair separates the description', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat:Add new feature'])]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);

    expect(entries[0]?.sections[0]?.items[0]?.description).toBe('#1 feat:Add new feature');
  });

  it('drops every commit the classifier rejects, and the release when none survives', () => {
    // A window holds the whole range, so the classifier is the only filter.
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v1.1.0', ['release: v1.1.0', '#4 fmt: Run prettier'], 1_710_000_000),
      makeWindow('v1.0.0', [
        'release: v1.0.0',
        'Merge pull request #7 from owner/branch',
        'deps: Bump deps',
        '#1 fmt: Run prettier',
        '#2 chore: Rework build',
        '#3 feat: Add widget',
      ]),
    ]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v1.1.0', OPTIONS);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(entries[0]?.sections).toStrictEqual([
      { title: '🎉 Features', audience: 'all', items: [{ description: 'Add widget', hash: fakeHash(5) }] },
    ]);
  });

  it('reads the windows once and never writes the changelog file', () => {
    // Persistence is the caller's concern, so this helper never short-circuits.
    mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat: Add widget'])]);

    const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);

    expect(mockEnumerateReleaseWindows).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it('reads the windows for the tag prefixes and paths, naming the unreleased one after the tag', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('foo-v1.0.0', ['#1 feat: Add widget'])]);

    buildChangelogEntries(makeConfig(), 'foo-v1.0.0', { tagPrefixes: ['foo-v', 'old-foo-v'], paths: ['packages/foo'] });

    expect(mockEnumerateReleaseWindows).toHaveBeenCalledWith({
      paths: ['packages/foo'],
      tagPrefixes: ['foo-v', 'old-foo-v'],
      unreleasedTag: 'foo-v1.0.0',
    });
  });

  it('reads every path when no paths are given', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([]);

    buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);

    expect(mockEnumerateReleaseWindows).toHaveBeenCalledWith({ tagPrefixes: ['v'], unreleasedTag: 'v1.0.0' });
  });

  it('wraps thrown errors from the helper with site-specific context', () => {
    mockEnumerateReleaseWindows.mockImplementationOnce(() => {
      throw new Error('git log exited with code 1');
    });

    expect(() => buildChangelogEntries(makeConfig(), 'v9.9.9', OPTIONS)).toThrow(
      'Failed to build changelog entries for tag v9.9.9: git log exited with code 1',
    );
  });

  it('preserves the underlying error as the cause', () => {
    const underlying = new Error('git log exited with code 1');
    mockEnumerateReleaseWindows.mockImplementationOnce(() => {
      throw underlying;
    });

    expect(() => buildChangelogEntries(makeConfig(), 'v9.9.9', OPTIONS)).toThrow(
      expect.objectContaining({ cause: underlying }),
    );
  });

  describe('commit hash capture', () => {
    it("carries each commit's full hash into `ChangelogItem.hash`", () => {
      const hash = '8296231173de8be01977dabbe9c1c8e8e1234abc';
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        { version: 'v1.0.0', timestamp: 1_700_000_000, commits: [makeCommit('#1 feat: Add widget', hash)] },
      ]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.hash).toBe(hash);
    });
  });

  describe('breaking marker', () => {
    it('sets breaking: true for a `feat!:` commit', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat!: Redesign API'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('omits breaking for a `feat:` commit (no `!`)', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat: Add widget'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });

    it('sets breaking: true for a `drop!:` commit', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 drop!: Remove legacy endpoint'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('sets breaking: true for a scoped `type(scope)!:` commit', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat(api)!: Redesign endpoint'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('sets breaking: true for a pipe-scoped `scope|type!:` commit', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 web|feat!: Reshape API'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('does NOT set breaking when only the body footer carries `BREAKING CHANGE:` (prefix `!` is required)', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('v1.0.0', ['#1 feat: Add widget\n\nBREAKING CHANGE: removes /v1 path']),
      ]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });

    it.each([
      '#1 deprecate!: Deprecate legacy flag',
      '#1 refactor!: Restructure parser',
      '#1 utility!: Add shared helper',
    ])('omits breaking for `%s`, whose type forbids `!`', (message) => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', [message])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });

    it('sets breaking: true for a `refactor!:` commit when `breakingPolicies` is `{}`', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 refactor!: Restructure parser'])]);
      const { entries } = buildChangelogEntries({ ...makeConfig(), breakingPolicies: {} }, 'v1.0.0', OPTIONS);
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('omits breaking for a `feat!:` commit when `breakingPolicies` forbids `feat`', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 feat!: Redesign API'])]);
      const { entries } = buildChangelogEntries(
        { ...makeConfig(), breakingPolicies: { ...DEFAULT_BREAKING_POLICIES, feat: 'forbidden' } },
        'v1.0.0',
        OPTIONS,
      );
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });

    it('admits no `!` commit whose type is not a configured work type', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 chore!: Rework build'])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      expect(entries).toStrictEqual([]);
    });

    it('omits breaking for a `!` commit whose type is added by `workTypes` and forbidden by `breakingPolicies`', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', ['#1 chore!: Rework build'])]);
      const { entries } = buildChangelogEntries(
        {
          ...makeConfig(),
          workTypes: { ...DEFAULT_WORK_TYPES, chore: { header: 'Chores' } },
          breakingPolicies: { ...DEFAULT_BREAKING_POLICIES, chore: 'forbidden' },
        },
        'v1.0.0',
        OPTIONS,
      );
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });
  });

  describe('body extraction', () => {
    function runAndReadItems(message: string): ChangelogEntry['sections'][number]['items'] {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', [message])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      return entries[0]?.sections[0]?.items ?? [];
    }

    it('omits body field when commit has no body text', () => {
      const items = runAndReadItems('#1 feat: Add widget');
      expect(items[0]).toStrictEqual({ description: 'Add widget', hash: fakeHash(0) });
      expect(items[0]).not.toHaveProperty('body');
    });

    it('omits body field when commit message has no newline at all', () => {
      const items = runAndReadItems('#1 feat: No newline at all');
      expect(items[0]).not.toHaveProperty('body');
    });

    it('extracts single-paragraph body text', () => {
      const items = runAndReadItems('#1 feat: Add widget\n\nThis paragraph explains the widget in more detail.');
      expect(items[0]?.body).toBe('This paragraph explains the widget in more detail.');
    });

    it('extracts multi-paragraph body text preserving internal blank lines', () => {
      const message = '#1 feat: Add widget\n\nFirst paragraph of the body.\n\nSecond paragraph with more detail.';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('First paragraph of the body.\n\nSecond paragraph with more detail.');
    });

    it('strips trailing Signed-off-by trailer', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nSigned-off-by: Author <a@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing Co-authored-by trailer', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nCo-authored-by: Helper <h@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing Closes/Fixes/Resolves references', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nCloses #42\nFixes #43\nResolves #44';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing bare pull-request URL', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nhttps://github.com/owner/repo/pull/99';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips a mixed trailer block', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body text here.',
        '',
        'Co-authored-by: Helper <h@example.com>',
        'Signed-off-by: Author <a@example.com>',
        'Closes #10',
        'https://github.com/owner/repo/pull/99',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('preserves mid-body trailer-lookalike lines', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body paragraph one mentions Closes #10 in passing.',
        '',
        'Body paragraph two.',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body paragraph one mentions Closes #10 in passing.\n\nBody paragraph two.');
    });

    it('returns no body when message has only trailer lines', () => {
      const message = '#1 feat: Add widget\n\nSigned-off-by: Author <a@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]).not.toHaveProperty('body');
    });

    it('strips a trailing block of Change trailers', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body text here.',
        '',
        'Change: agents|feat: Adds the parser',
        'Change: agents|fix: Corrects the guard',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips Change trailers interleaved with the other trailers', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body text here.',
        '',
        'Change: agents|feat: Adds the parser',
        'Co-authored-by: Helper <h@example.com>',
        'Closes #10',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('preserves a Change line above non-trailer content', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Change: agents|feat: Adds the parser',
        '',
        'Body paragraph two.',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Change: agents|feat: Adds the parser\n\nBody paragraph two.');
    });

    it('returns no body when message has only Change trailers', () => {
      const message = '#1 feat: Add widget\n\nChange: agents|feat: Adds the parser';
      const items = runAndReadItems(message);
      expect(items[0]).not.toHaveProperty('body');
    });
  });

  describe('migration extraction', () => {
    function runAndReadItems(message: string): ChangelogEntry['sections'][number]['items'] {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', [message])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      return entries[0]?.sections[0]?.items ?? [];
    }

    it('extracts the labeled paragraph and leaves it in the body', () => {
      const message =
        '#1 feat!: Rename the field\n\nRenames `name` to `id`.\n\nMigration: Change any uses of `name` to `id`.';
      const items = runAndReadItems(message);
      expect(items[0]?.migration).toBe('Change any uses of `name` to `id`.');
      expect(items[0]?.body).toBe('Renames `name` to `id`.\n\nMigration: Change any uses of `name` to `id`.');
    });

    it('extracts from a non-breaking commit', () => {
      const message = '#1 fix: Tighten version validation\n\nMigration: Quote every version number in a rulebook.';
      const items = runAndReadItems(message);
      expect(items[0]?.migration).toBe('Quote every version number in a rulebook.');
      expect(items[0]).not.toHaveProperty('breaking');
    });

    it('extracts from the trailer-stripped body, not the raw message', () => {
      const message =
        '#1 feat: Add widget\n\nMigration: Import from the new subpath.\nSigned-off-by: Author <a@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]?.migration).toBe('Import from the new subpath.');
    });

    it('extracts the migration when a Change trailer block follows it', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Migration: Import from the new subpath.',
        '',
        'Change: agents|feat: Adds the parser',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.migration).toBe('Import from the new subpath.');
      expect(items[0]?.body).toBe('Migration: Import from the new subpath.');
    });

    it('omits migration when the body carries no labeled paragraph', () => {
      const items = runAndReadItems('#1 feat: Add widget\n\nIntroduces a widget.');
      expect(items[0]).not.toHaveProperty('migration');
    });

    it('omits migration when the commit has no body', () => {
      const items = runAndReadItems('#1 feat: Add widget');
      expect(items[0]).not.toHaveProperty('migration');
    });
  });

  describe('change-record blocks', () => {
    function build(messages: readonly string[]): ReturnType<typeof buildChangelogEntries> {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.1.0', messages)]);
      return buildChangelogEntries(
        { ...makeConfig(), breakingPolicies: DEFAULT_BREAKING_POLICIES, workTypes: DEFAULT_WORK_TYPES },
        'v1.1.0',
        OPTIONS,
      );
    }

    it('yields one item per entry, sectioned by its type, with its breaking flag, migration, suffix, and position', () => {
      const message = mergeMessage(`
pr_number: 42
entries:
  - type: feat
    scopes: [release-kit]
    breaking: true
    text: adds the reader.
    migration: Read \`entries\` instead.
  - type: fix
    text: Corrects the guard.
  - type: tests
    text: Covers the reader.
`);

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections).toStrictEqual([
        {
          title: DEFAULT_WORK_TYPES['feat']?.header,
          audience: 'all',
          items: [
            {
              description: 'adds the reader. (#42)',
              breaking: true,
              migration: 'Read `entries` instead.',
              hash: fakeHash(0),
              entry: 1,
            },
          ],
        },
        {
          title: DEFAULT_WORK_TYPES['fix']?.header,
          audience: 'all',
          items: [{ description: 'Corrects the guard. (#42)', hash: fakeHash(0), entry: 2 }],
        },
        {
          title: DEFAULT_WORK_TYPES['tests']?.header,
          audience: 'dev',
          items: [{ description: 'Covers the reader. (#42)', hash: fakeHash(0), entry: 3 }],
        },
      ]);
      expect(diagnostics).toStrictEqual({ malformedBlocks: [], policyViolations: [], undeclaredEntryTypes: [] });
    });

    it('omits the suffix when the block records no `pr_number`', () => {
      const { entries } = build([mergeMessage('entries:\n  - type: fix\n    text: Corrects the guard.')]);

      expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Corrects the guard.');
    });

    it('carries no body, even when the commit message has one', () => {
      const { entries } = build([mergeMessage('entries:\n  - type: fix\n    text: Corrects the guard.')]);

      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('body');
    });

    it('resolves an entry type through the work-type aliases', () => {
      const { entries } = build([mergeMessage('entries:\n  - type: feature\n    text: Adds a thing.')]);

      expect(entries[0]?.sections[0]?.title).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });

    it('bypasses the ticket-prefix and title-type gates', () => {
      const message = ['Squash the branch', '', block('entries:\n  - type: fix\n    text: Corrects the guard.')].join(
        '\n',
      );

      const { entries } = build([message]);

      expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Corrects the guard.');
    });

    it('drops an excluded entry silently while counting it in the positions', () => {
      const message = mergeMessage('entries:\n  - type: fmt\n    text: Reformats.\n  - type: fix\n    text: Fixes.');

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections.flatMap((section) => section.items)).toStrictEqual([
        { description: 'Fixes.', hash: fakeHash(0), entry: 2 },
      ]);
      expect(diagnostics.undeclaredEntryTypes).toStrictEqual([]);
    });

    it('reports an undeclared entry type and yields no item for it', () => {
      const message = mergeMessage('entries:\n  - type: chore\n    text: Tidies.\n  - type: fix\n    text: Fixes.');

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections.flatMap((section) => section.items)).toStrictEqual([
        { description: 'Fixes.', hash: fakeHash(0), entry: 2 },
      ]);
      expect(diagnostics.undeclaredEntryTypes).toStrictEqual([
        { commitHash: fakeHash(0), commitSubject: MERGE_SUBJECT, entryPosition: 1, type: 'chore' },
      ]);
    });

    it('reports a breaking entry whose type forbids it, and does not mark the item breaking', () => {
      const { entries, diagnostics } = build([
        mergeMessage(
          'entries:\n  - type: fix\n    text: Fixes.\n  - type: deprecate\n    breaking: true\n    text: Deprecates.',
        ),
      ]);

      const deprecated = entries[0]?.sections.find(
        (section) => section.title === DEFAULT_WORK_TYPES['deprecate']?.header,
      );
      expect(deprecated?.items[0]).not.toHaveProperty('breaking');
      expect(diagnostics.policyViolations).toStrictEqual([
        {
          commitHash: fakeHash(0),
          commitSubject: MERGE_SUBJECT,
          type: 'deprecate',
          surface: 'entry',
          entryPosition: 2,
        },
      ]);
    });

    it('reports a non-breaking entry whose type requires breaking', () => {
      const { diagnostics } = build([mergeMessage('entries:\n  - type: drop\n    text: Removes the flag.')]);

      expect(diagnostics.policyViolations).toStrictEqual([
        { commitHash: fakeHash(0), commitSubject: MERGE_SUBJECT, type: 'drop', surface: 'entry', entryPosition: 1 },
      ]);
    });

    it('treats a type with no policy entry as optional', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('v1.1.0', [mergeMessage('entries:\n  - type: drop\n    breaking: true\n    text: Removes.')]),
      ]);

      const { entries, diagnostics } = buildChangelogEntries(
        { ...makeConfig(), breakingPolicies: {} },
        'v1.1.0',
        OPTIONS,
      );

      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
      expect(diagnostics.policyViolations).toStrictEqual([]);
    });

    it.each([
      ['absent', '#9 fix: Title fix\n\nNo block here.'],
      ['empty', `#9 fix: Title fix\n\n${block('pr_number: 3\nentries: []')}`],
    ])('falls back to the title when the block is %s, reporting nothing', (_label, message) => {
      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections[0]?.items).toHaveLength(1);
      expect(entries[0]?.sections[0]?.items[0]).toMatchObject({ description: 'Title fix', hash: fakeHash(0) });
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('entry');
      expect(diagnostics.malformedBlocks).toStrictEqual([]);
    });

    it('falls back to the title for a malformed block, and reports the block', () => {
      const message = `#9 fix: Title fix\n\nLede paragraph.\n\n${block('entries:\n  - type: fix')}`;

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections[0]?.items).toStrictEqual([
        { description: 'Title fix', body: 'Lede paragraph.', hash: fakeHash(0) },
      ]);
      expect(diagnostics.malformedBlocks).toStrictEqual([
        { commitHash: fakeHash(0), commitSubject: '#9 fix: Title fix', reason: '`entries[0].text` is missing' },
      ]);
    });

    it('yields nothing for a malformed block on a commit whose title does not classify, and still reports it', () => {
      const { entries, diagnostics } = build([`Squash the branch\n\n${block('entries: 3')}`]);

      expect(entries).toStrictEqual([]);
      expect(diagnostics.malformedBlocks).toHaveLength(1);
    });

    it.each([
      ['release:', 'release: v1.1.0'],
      ['Merge', "Merge branch 'main'"],
    ])('skips a `%s` commit that carries a block, reading nothing from it', (_label, subject) => {
      const { entries, diagnostics } = build([`${subject}\n\n${block('entries: 3')}`]);

      expect(entries).toStrictEqual([]);
      expect(diagnostics.malformedBlocks).toStrictEqual([]);
    });

    it('builds items from a released window but records diagnostics only for the unreleased one', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('v1.1.0', ['#2 fix: Current']),
        makeWindow('v1.0.0', [
          mergeMessage('entries:\n  - type: chore\n    text: Tidies.\n  - type: fix\n    text: Fixes.'),
          `#1 fix: Old\n\n${block('entries: 3')}`,
          mergeMessage('entries:\n  - type: drop\n    text: Removes.'),
        ]),
      ]);

      const { entries, diagnostics } = buildChangelogEntries(makeConfig(), 'v1.1.0', OPTIONS);

      expect(entries[1]?.sections.flatMap((section) => section.items.map((item) => item.description))).toStrictEqual([
        'Removes.',
        'Fixes.',
        'Old',
      ]);
      expect(diagnostics).toStrictEqual({ malformedBlocks: [], policyViolations: [], undeclaredEntryTypes: [] });
    });
  });
});

describe('buildChangelogEntries + renderReleaseNotesSingle integration', () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('renders public release notes with priority-ordered sections, bodies under bullets, and no dev-only or skipped sections', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('v0.17.0', [
        '#2 feat: Add widget API\n\nIntroduces a widget API for consumers.',
        '#3 refactor: Reshape internals\n\nConsolidates helper modules.',
        '#1 fix: Fix crash on startup\n\nFixes a regression that crashed the app when the config file was missing.\n\nSigned-off-by: Author <a@example.com>',
      ]),
    ]);

    const { entries } = buildChangelogEntries(
      makeConfig({ devOnlySections: DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections }),
      'v0.17.0',
      OPTIONS,
    );
    const entry = entries[0];
    assert(entry !== undefined);

    // `fmt` is excluded from the changelog; confirm no Formatting section ever reaches the JSON.
    const sectionTitles = entry.sections.map((section) => section.title);
    expect(sectionTitles).not.toContain('Formatting');

    const sectionOrder = Object.values(DEFAULT_WORK_TYPES).map((config) => config.header);

    const rendered = renderReleaseNotesSingle(entry, {
      filter: matchesAudience('all'),
      includeHeading: false,
      sectionOrder,
    });

    // Public release notes: Features before Bug fixes (canonical Public-tier order), no Refactoring, no Formatting.
    // Emoji-tolerant matching: the contract is "a Features section appears before a Bug fixes section",
    // independent of the specific decorative emoji prefix in the header.
    const bugFixesIndex = rendered.search(/### (?:\S+ )?Bug fixes\b/);
    const featuresIndex = rendered.search(/### (?:\S+ )?Features\b/);
    expect(featuresIndex).toBeGreaterThanOrEqual(0);
    expect(bugFixesIndex).toBeGreaterThan(featuresIndex);
    expect(rendered).not.toMatch(/### (?:\S+ )?Refactoring\b/);
    expect(rendered).not.toMatch(/### (?:\S+ )?Formatting\b/);

    // Body text renders as two-space-indented paragraphs under the bullet, and signed-off-by is stripped.
    expect(rendered).toContain(
      '- Fix crash on startup\n\n  Fixes a regression that crashed the app when the config file was missing.',
    );
    expect(rendered).toContain('- Add widget API\n\n  Introduces a widget API for consumers.');
    expect(rendered).not.toContain('Signed-off-by');
  });
});

// region | Helpers

/** Builds a raw commit, splitting its body from the subject as git does. */
function makeCommit(message: string, hash: string): RawCommit {
  const subject = message.split('\n', 1)[0] ?? '';
  const bodyStart = message.indexOf('\n\n');
  return { hash, subject, body: bodyStart === -1 ? '' : message.slice(bodyStart + 2), message };
}

/** Builds a release window whose commits carry `fakeHash` of their position in it. */
function makeWindow(version: string, messages: readonly string[], timestamp = 1_700_000_000): ReleaseWindow {
  return { version, timestamp, commits: messages.map((message, index) => makeCommit(message, fakeHash(index))) };
}

/** The subject of the merge commit that `mergeMessage` builds. */
const MERGE_SUBJECT = '#867 release-kit|feat: Read the change record (#42)';

/** Wraps a YAML payload in a `change-record` fence. */
function block(payload: string): string {
  return ['```change-record', payload.trim(), '```'].join('\n');
}

/** Builds a squash-merge message whose body ends with a `change-record` block. */
function mergeMessage(payload: string): string {
  return [MERGE_SUBJECT, '', 'Lede paragraph.', '', block(payload)].join('\n');
}

/** Returns a 40-character hash that encodes an index. */
function fakeHash(index: number): string {
  return String(index).padStart(40, '0');
}

// endregion | Helpers
