import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { findReleaseNotes, readReleaseNotes } from '../readReleaseNotes.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const BARE_APP = path.join(FIXTURES_DIR, 'app-bare');
const JSON_APP = path.join(FIXTURES_DIR, 'app-with-changelog-json');
const MARKDOWN_APP = path.join(FIXTURES_DIR, 'app-with-changelog-md');

const JSON_NOTES_0_7_0 = {
  date: '2026-10-08',
  markdown: [
    '### 🎉 Features',
    '',
    '- Adds the widget.',
    '',
    '  Line one.',
    '',
    '  Line two.',
    '',
    '- Adds the gadget.',
    '',
    '### 🐛 Bug fixes',
    '',
    '- Fixes the crash.',
  ].join('\n'),
  sections: [
    {
      title: '🎉 Features',
      items: [{ description: 'Adds the widget.', body: 'Line one.\n\nLine two.' }, { description: 'Adds the gadget.' }],
    },
    { title: '🐛 Bug fixes', items: [{ description: 'Fixes the crash.' }] },
  ],
};

describe(findReleaseNotes, () => {
  it("renders the public sections of the JSON entry, ignoring CHANGELOG.md's version of it", () => {
    expect(findReleaseNotes(JSON_APP, '0.7.0')).toStrictEqual(JSON_NOTES_0_7_0);
  });

  it('returns undefined for a JSON entry with only dev sections, without reading CHANGELOG.md', () => {
    expect(findReleaseNotes(JSON_APP, '0.6.0')).toBeUndefined();
  });

  it('falls back to CHANGELOG.md for a version that the JSON lacks', () => {
    expect(findReleaseNotes(JSON_APP, '0.4.0')).toStrictEqual({
      date: '2026-07-01',
      markdown: '### 🐛 Bug fixes\n\n- Fixes the older typo.',
    });
  });

  it('reads a dated CHANGELOG.md heading', () => {
    expect(findReleaseNotes(MARKDOWN_APP, '0.7.0')).toStrictEqual({
      date: '2026-10-08',
      markdown: '### 🎉 Features\n\n- Adds the widget.',
    });
  });

  it('reads an undated CHANGELOG.md heading, omitting the date', () => {
    expect(findReleaseNotes(MARKDOWN_APP, '0.6.0')).toStrictEqual({
      markdown: '### 🐛 Bug fixes\n\n- Fixes the crash.',
    });
  });

  it.each([
    ['an empty CHANGELOG.md section', MARKDOWN_APP, '0.5.0'],
    ['a version that neither file has', JSON_APP, '0.1.0'],
    ['a directory without a changelog', BARE_APP, '0.7.0'],
  ])('returns undefined for %s', (_label, cwd, version) => {
    expect(findReleaseNotes(cwd, version)).toBeUndefined();
  });

  it('falls back to CHANGELOG.md when the JSON is malformed', () => {
    using tree = createTempTree(
      { '.meta/changelog.json': '[{ "version":', 'CHANGELOG.md': '## 0.7.0\n\n- Adds the widget.\n' },
      { prefix: 'build-info-release-notes-' },
    );

    expect(findReleaseNotes(tree.dir, '0.7.0')).toStrictEqual({ markdown: '- Adds the widget.' });
  });

  it('skips a malformed JSON entry, falling back to CHANGELOG.md for its version', () => {
    using tree = createTempTree(
      {
        '.meta/changelog.json': JSON.stringify([{ version: '0.7.0', date: '2026-10-08', sections: [{ title: 'x' }] }]),
        'CHANGELOG.md': '## 0.7.0\n\n- Adds the widget.\n',
      },
      { prefix: 'build-info-release-notes-' },
    );

    expect(findReleaseNotes(tree.dir, '0.7.0')).toStrictEqual({ markdown: '- Adds the widget.' });
  });
});

describe(readReleaseNotes, () => {
  it('returns every JSON entry with a public section, newest first', () => {
    expect(readReleaseNotes({ cwd: JSON_APP })).toStrictEqual([
      { version: '0.7.0', ...JSON_NOTES_0_7_0 },
      {
        version: '0.5.0',
        date: '2026-08-01',
        markdown: '### 🐛 Bug fixes\n\n- Fixes the typo.',
        sections: [{ title: '🐛 Bug fixes', items: [{ description: 'Fixes the typo.' }] }],
      },
    ]);
  });

  it('returns every non-empty version section of CHANGELOG.md when the JSON is missing', () => {
    expect(readReleaseNotes({ cwd: MARKDOWN_APP })).toStrictEqual([
      { version: '0.7.0', date: '2026-10-08', markdown: '### 🎉 Features\n\n- Adds the widget.' },
      { version: '0.6.0', markdown: '### 🐛 Bug fixes\n\n- Fixes the crash.' },
    ]);
  });

  it('returns an empty list without a changelog', () => {
    expect(readReleaseNotes({ cwd: BARE_APP })).toStrictEqual([]);
  });
});
