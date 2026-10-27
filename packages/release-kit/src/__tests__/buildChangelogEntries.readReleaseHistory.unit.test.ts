import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from '../defaults.ts';
import type { ReleaseWindow } from '../enumerateReleaseWindows.ts';
import { block, fakeHash, makeConfig, makeWindow, mergeMessage, OPTIONS } from '../test-utils/changelogCommits.ts';
import { makeWorkspaceTarget } from '../test-utils/packageTargets.ts';
import type { ChangelogSection } from '../types.ts';

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

import { readReleaseHistory, type ReleaseHistory } from '../buildChangelogEntries.ts';
import { decideTargetRelease } from '../prepareTarget.ts';

describe(readReleaseHistory, () => {
  beforeEach(() => {
    mockEnumerateReleaseWindows.mockReset();
  });

  describe('bump', () => {
    it.each([
      [
        'a `feat` entry under a `docs` title',
        [mergeMessage('entries:\n  - type: feat\n    text: Adds.', '#1 docs: Guide')],
        'minor',
      ],
      ['a breaking entry', [mergeMessage('entries:\n  - type: fix\n    breaking: true\n    text: Breaks.')], 'major'],
      ['a `feat!:` title', ['#1 feat!: Redesign API'], 'major'],
      ['the highest of several items', ['#1 fix: Patch', '#2 feat: Add', '#3 docs: Guide'], 'minor'],
      ['a `BREAKING CHANGE:` footer on a `feat` title', ['#1 feat: Add\n\nBREAKING CHANGE: removes /v1'], 'minor'],
      ['a dev-only section', ['#1 tests: Cover the parser'], 'patch'],
    ])('is the maximum over the items for %s', (_label, messages, bump) => {
      expect(readUnreleased(messages).bump).toBe(bump);
    });

    it.each([
      ['an unticketed `feat`', ['feat: Add widget']],
      ['an excluded type', ['#1 fmt: Run prettier']],
      [
        'a block whose entries are all undeclared or excluded',
        [mergeMessage('entries:\n  - type: chore\n    text: T.\n  - type: fmt\n    text: F.')],
      ],
      ['no commits', []],
    ])('is undefined for %s', (_label, messages) => {
      expect(readUnreleased(messages).bump).toBeUndefined();
    });

    it('reads only the unreleased window', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('unreleased', ['#2 fix: Current']),
        makeWindow('v1.0.0', ['#1 feat!: Old']),
      ]);

      expect(readReleaseHistory(makeConfig(), OPTIONS).unreleased.bump).toBe('patch');
    });

    it('follows the configured version patterns', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('unreleased', ['#1 perf: Speed up'])]);

      const history = readReleaseHistory(
        { ...makeConfig(), versionPatterns: { major: ['!'], minor: ['feat', 'perf'] } },
        OPTIONS,
      );

      expect(history.unreleased.bump).toBe('minor');
    });
  });

  describe('commits', () => {
    it('lists the unreleased commits newest first, without release commits', () => {
      const { commits } = readUnreleased(['#1 feat: First', 'release: v1.1.0', "Merge branch 'main'", '#2 fix: Last']);

      expect(commits.map((commit) => commit.subject)).toStrictEqual([
        '#2 fix: Last',
        "Merge branch 'main'",
        '#1 feat: First',
      ]);
    });

    it('names the window below the unreleased one as the previous tag', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('unreleased', ['#2 fix: Current']),
        makeWindow('v1.1.0', ['#1 feat: Old']),
        makeWindow('v1.0.0', ['#0 feat: Older']),
      ]);

      expect(readReleaseHistory(makeConfig(), OPTIONS).previousTag).toBe('v1.1.0');
    });

    it('leaves the previous tag undefined when the enumerator does not find a matching tag', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('unreleased', ['#1 feat: First'])]);

      expect(readReleaseHistory(makeConfig(), OPTIONS).previousTag).toBeUndefined();
    });
  });

  describe('parsed and unparseable commits', () => {
    it('counts the commits that yield at least one item', () => {
      const unreleased = readUnreleased([
        '#1 feat: Add',
        mergeMessage('entries:\n  - type: fix\n    text: A.\n  - type: tests\n    text: B.'),
        '#3 fmt: Reformat',
        'Update readme',
      ]);

      expect(unreleased.parsedCommitCount).toBe(2);
    });

    it('lists, newest first, the commits whose titles lack a ticket prefix or a resolvable type', () => {
      const unreleased = readUnreleased(['Update readme', '#1 chore: Tidy', '#2 feat: Add', 'feat: Unticketed']);

      expect(unreleased.unparseableCommits?.map((commit) => commit.subject)).toStrictEqual([
        'feat: Unticketed',
        '#1 chore: Tidy',
        'Update readme',
      ]);
    });

    it('does not list a commit for which an exclusion or a diagnostic accounts', () => {
      const unreleased = readUnreleased([
        'release: v1.1.0',
        "Merge branch 'main'",
        '#1 fmt: Reformat',
        mergeMessage('entries:\n  - type: chore\n    text: Tidies.'),
        `Squash the branch\n\n${block('entries: 3')}`,
      ]);

      expect(unreleased.unparseableCommits).toBeUndefined();
      expect(unreleased.parsedCommitCount).toBe(0);
    });
  });

  describe('entry routing', () => {
    const ROUTED_MESSAGE = mergeMessage(`
entries:
  - type: feat
    scopes: [nmr]
    text: Adds to nmr.
  - type: fix
    scopes: [core-alias]
    text: Fixes core.
  - type: fix
    scopes: [release-kit, nmr]
    text: Fixes both.
  - type: tests
    text: Covers everything.
  - type: tests
    scopes: ['*']
    text: Covers every workspace.
  - type: internal
    scopes: [root]
    text: Tidies the root.
`);

    it.each([
      ['nmr', ['Adds to nmr.', 'Fixes both.', 'Covers everything.', 'Covers every workspace.']],
      ['nmr-core', ['Fixes core.', 'Covers everything.', 'Covers every workspace.']],
      ['release-kit', ['Fixes both.', 'Covers everything.', 'Covers every workspace.']],
      ['arrays', ['Covers everything.', 'Covers every workspace.']],
    ])(
      "keeps, for workspace '%s', the entries whose resolved scopes name it, are empty, or contain `*`",
      (scope, descriptions) => {
        expect(describeItems(readRouted([ROUTED_MESSAGE], scope).sections)).toStrictEqual(descriptions);
      },
    );

    it('keeps every entry for a read without a workspace', () => {
      expect(describeItems(readUnreleased([ROUTED_MESSAGE]).sections)).toHaveLength(6);
    });

    it('does not raise the bump for a breaking entry scoped to another workspace', () => {
      const message = mergeMessage(`
entries:
  - type: feat
    scopes: [release-kit]
    breaking: true
    text: Breaks release-kit.
  - type: fix
    scopes: [nmr]
    text: Fixes nmr.
`);

      expect(readRouted([message], 'nmr').bump).toBe('patch');
      expect(readRouted([message], 'release-kit').bump).toBe('major');
    });

    it('classifies a block commit whose entries are all routed to other workspaces by its title', () => {
      const unreleased = readRouted(
        [mergeMessage('entries:\n  - type: fix\n    scopes: [nmr]\n    text: A.')],
        'arrays',
      );

      expect(unreleased.bump).toBe('minor');
      expect(unreleased.parsedCommitCount).toBe(1);
      expect(describeItems(unreleased.sections)).toStrictEqual(['Read the change record (#42)']);
      expect(unreleased.unparseableCommits).toBeUndefined();
    });

    it('releases a dependency whose source change has every entry scoped to its dependent', () => {
      const message = mergeMessage(
        `
entries:
  - type: perf
    scopes: [nmr]
    text: Keys the check cache on the tree id.
  - type: fix
    scopes: [nmr]
    text: Fixes the delegated snapshot.
`,
        "#1073 nmr|fix: Key the check cache on the working tree's git tree id (#1078)",
      );

      const history = readReleaseHistoryOf([makeWindow('unreleased', [message])], 'nmr-core');
      const decision = decideTargetRelease(makeWorkspaceTarget('nmr-core'), history, {
        shouldForce: false,
        bumpOverride: undefined,
        setVersion: undefined,
      });

      expect(history.unreleased.bump).toBe('patch');
      expect(describeItems(history.unreleased.sections)).toStrictEqual([
        "Key the check cache on the working tree's git tree id (#1078)",
      ]);
      expect(decision).toMatchObject({ outcome: 'release', releaseType: 'patch' });
    });

    it('keeps a routed entry that yields no item from falling back to the title', () => {
      const unreleased = readRouted(
        [
          mergeMessage(
            'entries:\n  - type: fmt\n    scopes: [arrays]\n    text: Formats.\n  - type: feat\n    scopes: [nmr]\n    text: A.',
          ),
        ],
        'arrays',
      );

      expect(unreleased.bump).toBeUndefined();
      expect(unreleased.sections).toStrictEqual([]);
    });

    it('reports an unticketed commit whose entries are all routed to other workspaces as unparseable', () => {
      const unreleased = readRouted(
        [mergeMessage('entries:\n  - type: feat\n    scopes: [nmr]\n    text: A.', 'Add the reader')],
        'arrays',
      );

      expect(unreleased.bump).toBeUndefined();
      expect(unreleased.unparseableCommits).toHaveLength(1);
    });

    it('keeps the item of a commit without a block', () => {
      expect(readRouted(['#1 release-kit|feat: Add'], 'nmr').bump).toBe('minor');
    });

    it('routes the entries of released windows', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('unreleased', []),
        makeWindow('v1.0.0', [ROUTED_MESSAGE]),
      ]);

      const history = readReleaseHistory(routedConfig(), { ...OPTIONS, scope: 'arrays' });

      expect(describeItems(history.releasedEntries[0]?.sections ?? [])).toStrictEqual([
        'Covers everything.',
        'Covers every workspace.',
      ]);
    });

    it('classifies a released commit whose entries are all routed to other workspaces by its title', () => {
      const history = readReleaseHistoryOf(
        [
          makeWindow('unreleased', []),
          makeWindow('v1.0.0', [mergeMessage('entries:\n  - type: fix\n    scopes: [nmr]\n    text: A.')]),
        ],
        'arrays',
      );

      expect(describeItems(history.releasedEntries[0]?.sections ?? [])).toStrictEqual(['Read the change record (#42)']);
    });
  });

  describe('title policy violations', () => {
    it.each([
      [
        'a footer on a type that forbids it',
        '#1 refactor: Rework\n\nBREAKING CHANGE: renames the export',
        'refactor',
        'body',
      ],
      ['a marker on an excluded type that forbids it', '#1 fmt!: Reformat', 'fmt', 'prefix'],
      ['a marker on an internal type', '#1 internal!: Refactor the cache', 'internal', 'prefix'],
    ])('reports %s', (_label, message, type, surface) => {
      const [subject = ''] = message.split('\n', 1);

      expect(readUnreleased([message]).diagnostics.policyViolations).toStrictEqual([
        { commitHash: fakeHash(0), commitSubject: subject, type, surface },
      ]);
    });

    it('reports nothing when `breakingPolicies` is `{}`', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('unreleased', ['#1 internal!: Refactor the cache', '#2 fmt!: Reformat']),
      ]);

      const history = readReleaseHistory({ ...makeConfig(), breakingPolicies: {} }, OPTIONS);

      expect(history.unreleased.diagnostics.policyViolations).toStrictEqual([]);
    });

    it('reports nothing for a released window', () => {
      mockEnumerateReleaseWindows.mockReturnValueOnce([
        makeWindow('unreleased', ['#2 fix: Current']),
        makeWindow('v1.0.0', ['#1 internal!: Refactor the cache']),
      ]);

      expect(readReleaseHistory(makeConfig(), OPTIONS).unreleased.diagnostics.policyViolations).toStrictEqual([]);
    });
  });
});

// region | Helpers

/** Lists the item descriptions of `sections`, in section order. */
function describeItems(sections: readonly ChangelogSection[]): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.description));
}

/** Reads, for `scope`, a history made of `windows`, the unreleased one first. */
function readReleaseHistoryOf(windows: readonly ReleaseWindow[], scope: string): ReleaseHistory {
  mockEnumerateReleaseWindows.mockReturnValueOnce([...windows]);
  return readReleaseHistory(routedConfig(), { ...OPTIONS, scope });
}

/** Reads, for `scope`, a history whose only window is an unreleased one containing `messages`, oldest first. */
function readRouted(messages: readonly string[], scope: string): ReleaseHistory['unreleased'] {
  return readReleaseHistoryOf([makeWindow('unreleased', messages)], scope).unreleased;
}

/** Reads a history whose only window is an unreleased one containing `messages`, oldest first. */
function readUnreleased(messages: readonly string[]): ReturnType<typeof readReleaseHistory>['unreleased'] {
  mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('unreleased', messages)]);
  return readReleaseHistory(
    { ...makeConfig(), breakingPolicies: DEFAULT_BREAKING_POLICIES, workTypes: DEFAULT_WORK_TYPES },
    OPTIONS,
  ).unreleased;
}

/** Returns the default configuration with a `core-alias` → `nmr-core` scope alias. */
function routedConfig(): Parameters<typeof readReleaseHistory>[0] {
  return {
    ...makeConfig(),
    breakingPolicies: DEFAULT_BREAKING_POLICIES,
    scopeAliases: { 'core-alias': 'nmr-core' },
    workTypes: DEFAULT_WORK_TYPES,
  };
}

// endregion | Helpers
