import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeConfig, makeFakeHash, makeWindow, OPTIONS } from '../test-utils/changelogCommits.ts';
import type { ChangelogEntry } from '../types.ts';

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

  describe('body extraction', () => {
    function runAndReadItems(message: string): ChangelogEntry['sections'][number]['items'] {
      mockEnumerateReleaseWindows.mockReturnValueOnce([makeWindow('v1.0.0', [message])]);
      const { entries } = buildChangelogEntries(makeConfig(), 'v1.0.0', OPTIONS);
      return entries[0]?.sections[0]?.items ?? [];
    }

    it('omits body field when the commit does not have any body text', () => {
      const items = runAndReadItems('#1 feat: Add widget');
      expect(items[0]).toStrictEqual({ description: 'Add widget', hash: makeFakeHash(0) });
      expect(items[0]).not.toHaveProperty('body');
    });

    it('omits body field when the commit message does not contain any newline', () => {
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

    it('omits the body when the message has only trailer lines', () => {
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

    it('omits the body when the message has only Change trailers', () => {
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

    it('omits migration when the body does not contain a labeled paragraph', () => {
      const items = runAndReadItems('#1 feat: Add widget\n\nIntroduces a widget.');
      expect(items[0]).not.toHaveProperty('migration');
    });

    it('omits migration when the commit does not have a body', () => {
      const items = runAndReadItems('#1 feat: Add widget');
      expect(items[0]).not.toHaveProperty('migration');
    });
  });
});
