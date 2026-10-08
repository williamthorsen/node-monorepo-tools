import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { collectBuildInfo } from '../packages/build-info/src/collect/index.ts';
import { renderChangelogJson } from '../packages/release-kit/src/changelogJsonFile.ts';
import { matchesAudience, renderReleaseNotesSingle } from '../packages/release-kit/src/renderReleaseNotes.ts';
import type { ChangelogEntry } from '../packages/release-kit/src/types.ts';

const ENTRY: ChangelogEntry = {
  version: '0.7.0',
  date: '2026-10-08',
  sections: [
    {
      title: '🎉 Features',
      audience: 'all',
      items: [
        { description: 'Adds the widget.', body: 'Renders it in the header.\n\nHides it on small screens.' },
        { description: 'Adds the gadget.', hash: 'abc1234def5678abc1234def5678abc1234def56' },
      ],
    },
    { title: '🧪 Tests', audience: 'dev', items: [{ description: 'Covers the widget.' }] },
  ],
};

describe('build-info reads the changelog.json that release-kit writes', () => {
  it("returns the version's public sections as release notes", () => {
    using tree = createTempTree(
      {
        '.meta/changelog.json': renderChangelogJson([ENTRY]),
        'package.json': JSON.stringify({ name: 'app', version: ENTRY.version }),
      },
      { prefix: 'build-info-changelog-contract-' },
    );

    const { releaseNotes } = collectBuildInfo({ cwd: tree.dir, env: {}, readGit: false });

    expect(releaseNotes).toStrictEqual({
      date: '2026-10-08',
      markdown: renderReleaseNotesSingle(ENTRY, { filter: matchesAudience('all'), includeHeading: false }).trimEnd(),
      sections: [
        {
          title: '🎉 Features',
          items: [
            { description: 'Adds the widget.', body: 'Renders it in the header.\n\nHides it on small screens.' },
            { description: 'Adds the gadget.' },
          ],
        },
      ],
    });
  });
});
