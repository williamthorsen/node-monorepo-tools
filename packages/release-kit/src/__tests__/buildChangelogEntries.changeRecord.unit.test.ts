import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import {
  buildMergeMessage,
  makeConfig,
  makeFakeHash,
  makeWindow,
  MERGE_SUBJECT,
  OPTIONS,
  wrapInChangeRecordFence,
} from '../test-utils/changelogCommits.ts';

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

import { buildChangelogEntries } from '../buildChangelogEntries.ts';

describe(buildChangelogEntries, () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
    mockWriteFileSync.mockReset();
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
      const message = buildMergeMessage(`
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
              hash: makeFakeHash(0),
              entry: 1,
            },
          ],
        },
        {
          title: DEFAULT_WORK_TYPES['fix']?.header,
          audience: 'all',
          items: [{ description: 'Corrects the guard. (#42)', hash: makeFakeHash(0), entry: 2 }],
        },
        {
          title: DEFAULT_WORK_TYPES['tests']?.header,
          audience: 'dev',
          items: [{ description: 'Covers the reader. (#42)', hash: makeFakeHash(0), entry: 3 }],
        },
      ]);
      expect(diagnostics).toStrictEqual({
        malformedBlocks: [],
        policyViolations: [],
        undeclaredEntryTypes: [],
        unroutedEntryScopes: [],
      });
    });

    it('omits the suffix when the block does not record a `pr_number`', () => {
      const { entries } = build([buildMergeMessage('entries:\n  - type: fix\n    text: Corrects the guard.')]);

      expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Corrects the guard.');
    });

    it('omits the body, even when the commit message has one', () => {
      const { entries } = build([buildMergeMessage('entries:\n  - type: fix\n    text: Corrects the guard.')]);

      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('body');
    });

    it('resolves an entry type through the work-type aliases', () => {
      const { entries } = build([buildMergeMessage('entries:\n  - type: feature\n    text: Adds a thing.')]);

      expect(entries[0]?.sections[0]?.title).toBe(DEFAULT_WORK_TYPES['feat']?.header);
    });

    it('bypasses the ticket-prefix and title-type gates', () => {
      const message = [
        'Squash the branch',
        '',
        wrapInChangeRecordFence('entries:\n  - type: fix\n    text: Corrects the guard.'),
      ].join('\n');

      const { entries } = build([message]);

      expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Corrects the guard.');
    });

    it('drops an excluded entry silently while counting it in the positions', () => {
      const message = buildMergeMessage(
        'entries:\n  - type: fmt\n    text: Reformats.\n  - type: fix\n    text: Fixes.',
      );

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections.flatMap((section) => section.items)).toStrictEqual([
        { description: 'Fixes.', hash: makeFakeHash(0), entry: 2 },
      ]);
      expect(diagnostics.undeclaredEntryTypes).toStrictEqual([]);
    });

    it('reports an undeclared entry type and does not yield an item for it', () => {
      const message = buildMergeMessage(
        'entries:\n  - type: chore\n    text: Tidies.\n  - type: fix\n    text: Fixes.',
      );

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections.flatMap((section) => section.items)).toStrictEqual([
        { description: 'Fixes.', hash: makeFakeHash(0), entry: 2 },
      ]);
      expect(diagnostics.undeclaredEntryTypes).toStrictEqual([
        { commitHash: makeFakeHash(0), commitSubject: MERGE_SUBJECT, entryPosition: 1, type: 'chore' },
      ]);
    });

    it('reports a breaking entry whose type forbids it, and does not mark the item breaking', () => {
      const { entries, diagnostics } = build([
        buildMergeMessage(
          'entries:\n  - type: fix\n    text: Fixes.\n  - type: deprecate\n    breaking: true\n    text: Deprecates.',
        ),
      ]);

      const deprecatedSection = entries[0]?.sections.find(
        (section) => section.title === DEFAULT_WORK_TYPES['deprecate']?.header,
      );
      expect(deprecatedSection?.items[0]).not.toHaveProperty('breaking');
      expect(diagnostics.policyViolations).toStrictEqual([
        {
          commitHash: makeFakeHash(0),
          commitSubject: MERGE_SUBJECT,
          type: 'deprecate',
          surface: 'entry',
          entryPosition: 2,
        },
      ]);
    });

    it('does not report a violation for a non-breaking `drop` entry', () => {
      const { diagnostics } = build([buildMergeMessage('entries:\n  - type: drop\n    text: Removes the flag.')]);

      expect(diagnostics.policyViolations).toStrictEqual([]);
    });

    it('treats a type without a policy entry as optional', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('v1.1.0', [buildMergeMessage('entries:\n  - type: drop\n    breaking: true\n    text: Removes.')]),
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
      ['empty', `#9 fix: Title fix\n\n${wrapInChangeRecordFence('pr_number: 3\nentries: []')}`],
    ])('falls back to the title when the block is %s, reporting nothing', (_label, message) => {
      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections[0]?.items).toHaveLength(1);
      expect(entries[0]?.sections[0]?.items[0]).toMatchObject({ description: 'Title fix', hash: makeFakeHash(0) });
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('entry');
      expect(diagnostics.malformedBlocks).toStrictEqual([]);
    });

    it('falls back to the title for a malformed block, and reports the block', () => {
      const message = `#9 fix: Title fix\n\nLede paragraph.\n\n${wrapInChangeRecordFence('entries:\n  - type: fix')}`;

      const { entries, diagnostics } = build([message]);

      expect(entries[0]?.sections[0]?.items).toStrictEqual([
        { description: 'Title fix', body: 'Lede paragraph.', hash: makeFakeHash(0) },
      ]);
      expect(diagnostics.malformedBlocks).toStrictEqual([
        { commitHash: makeFakeHash(0), commitSubject: '#9 fix: Title fix', reason: '`entries[0].text` is missing' },
      ]);
    });

    it('yields nothing for a malformed block on a commit whose title does not classify, and still reports it', () => {
      const { entries, diagnostics } = build([`Squash the branch\n\n${wrapInChangeRecordFence('entries: 3')}`]);

      expect(entries).toStrictEqual([]);
      expect(diagnostics.malformedBlocks).toHaveLength(1);
    });

    it.each([
      ['release:', 'release: v1.1.0'],
      ['Merge', "Merge branch 'main'"],
    ])('skips a `%s` commit that contains a block, reading nothing from it', (_label, subject) => {
      const { entries, diagnostics } = build([`${subject}\n\n${wrapInChangeRecordFence('entries: 3')}`]);

      expect(entries).toStrictEqual([]);
      expect(diagnostics.malformedBlocks).toStrictEqual([]);
    });

    it('builds items from a released window but records diagnostics only for the unreleased one', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('v1.1.0', ['#2 fix: Current']),
        makeWindow('v1.0.0', [
          buildMergeMessage('entries:\n  - type: chore\n    text: Tidies.\n  - type: fix\n    text: Fixes.'),
          `#1 fix: Old\n\n${wrapInChangeRecordFence('entries: 3')}`,
          buildMergeMessage('entries:\n  - type: drop\n    text: Removes.'),
        ]),
      ]);

      const { entries, diagnostics } = buildChangelogEntries(makeConfig(), 'v1.1.0', OPTIONS);

      expect(entries[1]?.sections.flatMap((section) => section.items.map((item) => item.description))).toStrictEqual([
        'Removes.',
        'Fixes.',
        'Old',
      ]);
      expect(diagnostics).toStrictEqual({
        malformedBlocks: [],
        policyViolations: [],
        undeclaredEntryTypes: [],
        unroutedEntryScopes: [],
      });
    });
  });
});
