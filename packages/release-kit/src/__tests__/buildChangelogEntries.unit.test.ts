import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { matchesAudience, renderReleaseNotesSingle } from '../renderReleaseNotes.ts';
import { fakeHash, makeCommit, makeConfig, makeWindow, OPTIONS } from '../test-utils/changelogCommits.ts';

const { mockEnumerateReleaseWindows, mockWriteFileSync } = await vi.hoisted(
  () => import('../test-utils/buildChangelogEntriesMocks.ts'),
);

// Mock the enumerator so that the test exercises buildChangelogEntries' transformation logic
// without reading git history. `buildChangelogEntries.tool.test.ts` covers the real reader.
vi.mock(import('../enumerateReleaseWindows.ts'), () => ({
  enumerateReleaseWindows: mockEnumerateReleaseWindows,
}));

vi.mock(import('node:fs'), () => ({
  writeFileSync: mockWriteFileSync,
}));

import {
  buildChangelogEntries,
  readReleaseHistory,
  toChangelogEntries,
  toReleaseEntries,
} from '../buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';

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
    // matching the emoji-prefixed default title `'🏗️ Internal features'`, so that upgrading does not
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
    // sections in first-seen order. `changelog.json` sections follow canonical order, which this
    // test checks directly with an out-of-order window.
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

  it('drops every commit rejected by the classifier, and the release when none survives', () => {
    // A window contains the whole range, so the classifier is the only filter.
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

  it('reads the windows for the tag prefixes and paths, naming the unreleased entry after the tag', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('unreleased', ['#1 feat: Add widget'])]);

    const { entries } = buildChangelogEntries(makeConfig(), 'foo-v1.0.0', {
      tagPrefixes: ['foo-v', 'old-foo-v'],
      paths: ['packages/foo'],
    });

    expect(mockEnumerateReleaseWindows).toHaveBeenCalledWith({
      paths: ['packages/foo'],
      tagPrefixes: ['foo-v', 'old-foo-v'],
      unreleasedTag: 'unreleased',
    });
    expect(entries[0]?.version).toBe('1.0.0');
  });

  it('reads every path when the options omit `paths`', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([]);

    buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);

    expect(mockEnumerateReleaseWindows).toHaveBeenCalledWith({ tagPrefixes: ['v'], unreleasedTag: 'unreleased' });
  });

  it('wraps thrown errors from the helper with the tag prefixes that it read', () => {
    mockEnumerateReleaseWindows.mockImplementationOnce(() => {
      throw new Error('git log exited with code 1');
    });

    expect(() => buildChangelogEntries(makeConfig(), 'v9.9.9', { tagPrefixes: ['v', 'old-v'] })).toThrow(
      'Failed to read the release history for v, old-v: git log exited with code 1',
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
    it("copies each commit's full hash into `ChangelogItem.hash`", () => {
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

    it('does NOT set breaking when only the body footer contains `BREAKING CHANGE:` (prefix `!` is required)', () => {
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

    it('does not admit a `!` commit whose type is not a configured work type', () => {
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
});

describe(toChangelogEntries, () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
  });

  it('labels the unreleased window with the tag, ahead of the released entries', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('unreleased', ['#2 fix: Current']),
      makeWindow('v1.0.0', ['#1 feat: Old']),
    ]);
    const history = readReleaseHistory(makeConfig(), OPTIONS);

    expect(toChangelogEntries(history, 'v1.0.1').map((entry) => entry.version)).toStrictEqual(['1.0.1', '1.0.0']);
  });

  it('omits the unreleased window when it does not yield any item', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('unreleased', ['#2 fmt: Reformat']),
      makeWindow('v1.0.0', ['#1 feat: Old']),
    ]);
    const history = readReleaseHistory(makeConfig(), OPTIONS);

    expect(toChangelogEntries(history, 'v1.0.1').map((entry) => entry.version)).toStrictEqual(['1.0.0']);
  });
});

describe(toReleaseEntries, () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
  });

  it.each([
    ['no commits', []],
    ['commits that do not yield any item', ['#2 fmt: Reformat', 'Update readme']],
  ])('puts the synthetic entry ahead of the released entries for a window with %s', (_label, messages) => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('unreleased', messages),
      makeWindow('v1.0.0', ['#1 feat: Old']),
    ]);
    const history = readReleaseHistory(makeConfig(), OPTIONS);

    const entries = toReleaseEntries(history, 'v1.0.1', '2026-09-23');

    expect(entries).toStrictEqual([buildEmptyReleaseEntry('1.0.1', '2026-09-23'), ...history.releasedEntries]);
    expect(entries.map((entry) => entry.version)).toStrictEqual(['1.0.1', '1.0.0']);
  });

  it('returns what `toChangelogEntries` returns for a window that yields items', () => {
    mockEnumerateReleaseWindows.mockReturnValueOnce([
      makeWindow('unreleased', ['#2 fix: Current', '#3 fmt: Reformat']),
      makeWindow('v1.0.0', ['#1 feat: Old']),
    ]);
    const history = readReleaseHistory(makeConfig(), OPTIONS);

    expect(toReleaseEntries(history, 'v1.0.1', '2026-09-23')).toStrictEqual(toChangelogEntries(history, 'v1.0.1'));
  });
});

describe('buildChangelogEntries + renderReleaseNotesSingle integration', () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('renders public release notes with priority-ordered sections, bodies under bullets, and without dev-only or skipped sections', () => {
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

    // `fmt` is excluded from the changelog; confirm that the JSON never contains a Formatting section.
    const sectionTitles = entry.sections.map((section) => section.title);
    expect(sectionTitles).not.toContain('Formatting');

    const sectionOrder = Object.values(DEFAULT_WORK_TYPES).map((config) => config.header);

    const rendered = renderReleaseNotesSingle(entry, {
      filter: matchesAudience('all'),
      shouldIncludeHeading: false,
      sectionOrder,
    });

    // Public release notes: Features before Bug fixes (canonical Public-tier order), no Refactoring, no Formatting.
    // Emoji-tolerant matching: The contract is "a Features section appears before a Bug fixes section",
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
