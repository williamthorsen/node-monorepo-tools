import { describe, expect, it } from 'vitest';

import { buildChangelogEntries } from '../buildChangelogEntries.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { getCommitsSinceTarget } from '../getCommitsSinceTarget.ts';
import { scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';
import type { ChangelogEntry } from '../types.ts';

const CONFIG = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG } };

describe(buildChangelogEntries, () => {
  it('reads the commits that the bump reads for a bare directory path', () => {
    const repo = scaffoldGitRepo();
    repo.commit('#1 feat: Add the handler', { 'aws/handler.ts': 'export const handler = 1;\n' });
    repo.tag('aws-v1.0.0');
    const fixHash = repo.commit('#2 fix: Retry the upload', { 'aws/upload.ts': 'export const upload = 2;\n' });
    repo.commit('#3 feat: Add an unrelated tool', { 'tools/other.ts': 'export const other = 3;\n' });

    const bump = getCommitsSinceTarget(['aws-v'], ['aws']);
    const entries = buildChangelogEntries(CONFIG, 'aws-v1.1.0', { tagPrefixes: ['aws-v'], paths: ['aws'] });

    expect(bump.commits.map((commit) => commit.hash)).toStrictEqual([fixHash]);
    expect(summarize(entries)).toStrictEqual([
      { version: '1.1.0', descriptions: ['Retry the upload'] },
      { version: '1.0.0', descriptions: ['Add the handler'] },
    ]);
  });

  it("carries each commit's body and full hash into its item", () => {
    const repo = scaffoldGitRepo();
    const hash = repo.commit('#1 feat: Add the parser\n\nParses the manifest.\n\nSigned-off-by: A <a@example.com>');

    const entries = buildChangelogEntries(CONFIG, 'v1.0.0', { tagPrefixes: ['v'] });

    expect(entries[0]?.sections[0]?.items).toStrictEqual([
      { description: 'Add the parser', body: 'Parses the manifest.', hash },
    ]);
  });
});

// region | Helpers

/** Reduces entries to their versions and item descriptions. */
function summarize(entries: readonly ChangelogEntry[]): Array<{ version: string; descriptions: string[] }> {
  return entries.map((entry) => ({
    version: entry.version,
    descriptions: entry.sections.flatMap((section) => section.items.map((item) => item.description)),
  }));
}

// endregion | Helpers
