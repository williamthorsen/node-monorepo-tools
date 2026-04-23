import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeReleaseNotesPreviews } from '../writeReleaseNotesPreviews.ts';

/** Minimal changelog.json fixture with a public feature section and a dev-only internal section. */
const changelogJsonFixture = [
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

describe('writeReleaseNotesPreviews (integration)', () => {
  let tempDir: string;
  let changelogJsonPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'prepare-with-release-notes-'));
    writeFileSync(join(tempDir, 'README.md'), readmeWithMarker, 'utf8');
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    changelogJsonPath = join(tempDir, '.meta', 'changelog.json');
    writeFileSync(changelogJsonPath, JSON.stringify(changelogJsonFixture), 'utf8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes both preview files under docs/ with correct content for a pending release', () => {
    const result = writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features', 'Bug fixes'],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);

    const readmePreviewPath = join(tempDir, 'docs', 'README.v2.4.0.md');
    const releaseNotesPreviewPath = join(tempDir, 'docs', 'RELEASE_NOTES.v2.4.0.md');

    expect(existsSync(readmePreviewPath)).toBe(true);
    expect(existsSync(releaseNotesPreviewPath)).toBe(true);

    const readmePreview = readFileSync(readmePreviewPath, 'utf8');
    expect(readmePreview).toContain('# @scope/pkg');
    expect(readmePreview).toContain('## Installation');
    expect(readmePreview).toContain('### Features');
    expect(readmePreview).toContain('Add release-notes preview generator');
    // Dev-only sections must not leak into the public README preview.
    expect(readmePreview).not.toContain('Internal');

    const releaseNotesPreview = readFileSync(releaseNotesPreviewPath, 'utf8');
    expect(releaseNotesPreview).toContain('### Features');
    expect(releaseNotesPreview).toContain('Add release-notes preview generator');
    expect(releaseNotesPreview).not.toContain('Internal');
    expect(releaseNotesPreview.endsWith('\n')).toBe(true);
  });

  it('overwrites existing preview files on re-run with the same version', () => {
    // First pass.
    writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: false,
    });

    const readmePreviewPath = join(tempDir, 'docs', 'README.v2.4.0.md');
    // Mutate the existing file to something clearly stale.
    writeFileSync(readmePreviewPath, 'STALE CONTENT', 'utf8');
    expect(readFileSync(readmePreviewPath, 'utf8')).toBe('STALE CONTENT');

    // Second pass with the same tag should overwrite.
    const result = writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);
    expect(result.injectedReadme?.outcome).toBe('overwritten');
    expect(readFileSync(readmePreviewPath, 'utf8')).toContain('### Features');
  });

  it('creates the docs/ directory when it does not already exist', () => {
    const docsDir = join(tempDir, 'docs');
    expect(existsSync(docsDir)).toBe(false);

    writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: false,
    });

    expect(existsSync(docsDir)).toBe(true);
    expect(existsSync(join(docsDir, 'README.v2.4.0.md'))).toBe(true);
    expect(existsSync(join(docsDir, 'RELEASE_NOTES.v2.4.0.md'))).toBe(true);
  });

  it('skips the injected-README preview when the workspace has no README.md but still writes the standalone release notes', () => {
    // Remove the fixture README to simulate a workspace without one.
    rmSync(join(tempDir, 'README.md'));

    const result = writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);
    expect(result.injectedReadme?.outcome).toBe('skipped-no-readme');
    expect(existsSync(join(tempDir, 'docs', 'README.v2.4.0.md'))).toBe(false);
    expect(existsSync(join(tempDir, 'docs', 'RELEASE_NOTES.v2.4.0.md'))).toBe(true);
  });

  it('writes no files and reports renderSkipped when no changelog entry matches the tag', () => {
    const result = writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v9.9.9',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(true);
    expect(existsSync(join(tempDir, 'docs'))).toBe(false);
  });

  it('writes no files in dry-run mode', () => {
    const result = writeReleaseNotesPreviews({
      workspacePath: tempDir,
      tag: 'pkg-v2.4.0',
      changelogJsonPath,
      sectionOrder: ['Features'],
      dryRun: true,
    });

    expect(result.renderSkipped).toBe(false);
    expect(result.injectedReadme?.outcome).toBe('dry-run');
    expect(result.releaseNotes?.outcome).toBe('dry-run');
    expect(existsSync(join(tempDir, 'docs'))).toBe(false);
  });
});
