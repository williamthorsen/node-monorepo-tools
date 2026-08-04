import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'prepare-with-release-notes-'));
    writeFileSync(join(tempDir, 'README.md'), readmeWithMarker, 'utf8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Plan the previews for the fixture release, then apply them as the CLI boundary would. */
  function planAndApply(): void {
    const previews = planReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      entries: changelogJsonFixture,
      sectionOrder: ['Features', 'Bug fixes'],
    });
    applyReleasePlan({ writes: previews.writes, tags: [], summary: '', formatCommand: undefined, workspaces: [] });
  }

  it('writes both preview files under docs/ with correct content for a pending release', () => {
    planAndApply();

    const readmePreview = readFileSync(join(tempDir, 'docs', 'README.v2.4.0.md'), 'utf8');
    expect(readmePreview).toContain('# @scope/pkg');
    expect(readmePreview).toContain('## Installation');
    // Labeled heading anchors the injected content to a version.
    expect(readmePreview).toContain('## Release notes — v2.4.0 (2026-04-23)');
    expect(readmePreview).toContain('### Features');
    expect(readmePreview).toContain('Add release-notes preview generator');
    // Dev-only sections must not leak into the public README preview.
    expect(readmePreview).not.toContain('Internal');

    const releaseNotesPreview = readFileSync(join(tempDir, 'docs', 'RELEASE_NOTES.v2.4.0.md'), 'utf8');
    expect(releaseNotesPreview).toContain('## Release notes — v2.4.0 (2026-04-23)');
    expect(releaseNotesPreview).toContain('### Features');
    expect(releaseNotesPreview).toContain('Add release-notes preview generator');
    expect(releaseNotesPreview).not.toContain('Internal');
    expect(releaseNotesPreview.endsWith('\n')).toBe(true);
  });

  it('overwrites existing preview files on re-run with the same version', () => {
    planAndApply();

    const readmePreviewPath = join(tempDir, 'docs', 'README.v2.4.0.md');
    writeFileSync(readmePreviewPath, 'STALE CONTENT', 'utf8');

    planAndApply();

    expect(readFileSync(readmePreviewPath, 'utf8')).toContain('### Features');
  });

  it('creates the docs/ directory when it does not already exist', () => {
    expect(existsSync(join(tempDir, 'docs'))).toBe(false);

    planAndApply();

    expect(existsSync(join(tempDir, 'docs'))).toBe(true);
  });
});
