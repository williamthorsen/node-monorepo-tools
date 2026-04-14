import { describe, expect, it } from 'vitest';

import { matchesAudience, renderReleaseNotesMulti, renderReleaseNotesSingle } from '../renderReleaseNotes.ts';
import type { ChangelogEntry } from '../types.ts';

const sampleEntry: ChangelogEntry = {
  version: '2.0.0',
  date: '2024-11-15',
  sections: [
    { title: 'Features', audience: 'all', items: [{ description: 'Add widget API' }] },
    { title: 'Bug fixes', audience: 'all', items: [{ description: 'Fix crash on startup' }] },
    { title: 'CI', audience: 'dev', items: [{ description: 'Update pipeline config' }] },
  ],
};

describe(renderReleaseNotesSingle, () => {
  it('renders all sections with heading by default', () => {
    const result = renderReleaseNotesSingle(sampleEntry);
    expect(result).toBe(
      [
        '## 2.0.0 — 2024-11-15',
        '',
        '### Features',
        '',
        '- Add widget API',
        '',
        '### Bug fixes',
        '',
        '- Fix crash on startup',
        '',
        '### CI',
        '',
        '- Update pipeline config',
        '',
      ].join('\n'),
    );
  });

  it('omits version heading when includeHeading is false', () => {
    const result = renderReleaseNotesSingle(sampleEntry, { includeHeading: false });
    expect(result).not.toContain('## 2.0.0');
    expect(result).toContain('### Features');
  });

  it('filters sections using a predicate', () => {
    const result = renderReleaseNotesSingle(sampleEntry, { filter: matchesAudience('all') });
    expect(result).toContain('### Features');
    expect(result).toContain('### Bug fixes');
    expect(result).not.toContain('### CI');
  });

  it('returns empty string when all sections are filtered out', () => {
    const entry: ChangelogEntry = {
      version: '1.0.0',
      date: '2024-01-01',
      sections: [{ title: 'CI', audience: 'dev', items: [{ description: 'Pipeline update' }] }],
    };
    const result = renderReleaseNotesSingle(entry, { filter: matchesAudience('all') });
    expect(result).toBe('');
  });

  it('renders multiple items in a section', () => {
    const entry: ChangelogEntry = {
      version: '1.0.0',
      date: '2024-01-01',
      sections: [
        {
          title: 'Features',
          audience: 'all',
          items: [{ description: 'First feature' }, { description: 'Second feature' }],
        },
      ],
    };
    const result = renderReleaseNotesSingle(entry);
    expect(result).toContain('- First feature\n- Second feature');
  });
});

describe(matchesAudience, () => {
  it('"all" matches only all-audience sections', () => {
    const predicate = matchesAudience('all');
    expect(predicate({ title: 'Features', audience: 'all', items: [] })).toBe(true);
    expect(predicate({ title: 'CI', audience: 'dev', items: [] })).toBe(false);
  });

  it('"dev" matches all sections', () => {
    const predicate = matchesAudience('dev');
    expect(predicate({ title: 'Features', audience: 'all', items: [] })).toBe(true);
    expect(predicate({ title: 'CI', audience: 'dev', items: [] })).toBe(true);
  });
});

describe(renderReleaseNotesMulti, () => {
  it('concatenates multiple entries', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '2.0.0',
        date: '2024-11-15',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'New feature' }] }],
      },
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'Bug fix' }] }],
      },
    ];

    const result = renderReleaseNotesMulti(entries);
    expect(result).toContain('## 2.0.0');
    expect(result).toContain('## 1.0.0');
    expect(result.indexOf('## 2.0.0')).toBeLessThan(result.indexOf('## 1.0.0'));
  });

  it('skips entries that produce empty output after filtering', () => {
    const entries: ChangelogEntry[] = [
      {
        version: '2.0.0',
        date: '2024-11-15',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Public feature' }] }],
      },
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'CI', audience: 'dev', items: [{ description: 'Dev-only' }] }],
      },
    ];

    const result = renderReleaseNotesMulti(entries, { filter: matchesAudience('all') });
    expect(result).toContain('## 2.0.0');
    expect(result).not.toContain('## 1.0.0');
  });

  it('returns empty string when all entries produce empty output', () => {
    const result = renderReleaseNotesMulti([]);
    expect(result).toBe('');
  });
});
