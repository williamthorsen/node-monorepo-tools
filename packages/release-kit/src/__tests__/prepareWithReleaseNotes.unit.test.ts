import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { planReleaseNotesPreviews } from '../planReleaseNotesPreviews.ts';
import { applyReleasePlan } from '../releasePlan.ts';
import type { ChangelogEntry } from '../types.ts';

/** Minimal changelog.json fixture with a public feature section and a dev-only internal section. */
const changelogJsonFixture: ChangelogEntry[] = [
  {
    version: '2.4.0',
    date: '2026-04-23',
    sections: [
      {
        title: 'Features',
        audience: 'all',
        items: [{ description: 'Add release-notes preview generator', body: 'Adds the `--with-release-notes` flag.' }],
      },
      {
        title: 'Internal',
        audience: 'dev',
        items: [{ description: 'Refactor internal helper' }],
      },
    ],
  },
];

const readmeWithMarker = `# @scope/pkg

Short description.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

\`\`\`sh
npm install @scope/pkg
\`\`\`
`;

describe(planReleaseNotesPreviews, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'prepare-with-release-notes-' }));
    tree.write('README.md', readmeWithMarker);
  });

  /** Plan the previews for the fixture release, then apply them as the CLI boundary would. */
  function planAndApply(): void {
    const previews = planReleaseNotesPreviews({
      workspacePath: tree.dir,
      tag: 'pkg-v2.4.0',
      entries: changelogJsonFixture,
      sectionOrder: ['Features', 'Bug fixes'],
    });
    applyReleasePlan({ writes: previews.writes, tags: [], summary: '', formatCommand: undefined, workspaces: [] });
  }

  it('writes both preview files under docs/ with correct content for a pending release', () => {
    planAndApply();

    const readmePreview = tree.read('docs/README.v2.4.0.md');
    expect(readmePreview).toContain('# @scope/pkg');
    expect(readmePreview).toContain('## Installation');
    // Labeled heading anchors the injected content to a version.
    expect(readmePreview).toContain('## Release notes — v2.4.0 (2026-04-23)');
    expect(readmePreview).toContain('### Features');
    expect(readmePreview).toContain('Add release-notes preview generator');
    // Dev-only sections must not leak into the public README preview.
    expect(readmePreview).not.toContain('Internal');

    const releaseNotesPreview = tree.read('docs/RELEASE_NOTES.v2.4.0.md');
    expect(releaseNotesPreview).toContain('## Release notes — v2.4.0 (2026-04-23)');
    expect(releaseNotesPreview).toContain('### Features');
    expect(releaseNotesPreview).toContain('Add release-notes preview generator');
    expect(releaseNotesPreview).not.toContain('Internal');
    expect(releaseNotesPreview.endsWith('\n')).toBe(true);
  });

  it('overwrites existing preview files on re-run with the same version', () => {
    planAndApply();

    tree.write('docs/README.v2.4.0.md', 'STALE CONTENT');

    planAndApply();

    expect(tree.read('docs/README.v2.4.0.md')).toContain('### Features');
  });

  it('creates the docs/ directory when it does not already exist', () => {
    expect(tree.exists('docs')).toBe(false);

    planAndApply();

    expect(tree.exists('docs')).toBe(true);
  });
});
