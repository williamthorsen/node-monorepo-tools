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

  it('does not produce a leading newline when includeHeading is false', () => {
    const result = renderReleaseNotesSingle(sampleEntry, { includeHeading: false });
    expect(result.startsWith('###')).toBe(true);
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

  describe('sectionOrder', () => {
    it('orders sections by the provided priority when all titles are known', () => {
      const result = renderReleaseNotesSingle(sampleEntry, {
        sectionOrder: ['Bug fixes', 'Features', 'CI'],
      });
      const bugFixesIndex = result.indexOf('### Bug fixes');
      const featuresIndex = result.indexOf('### Features');
      const ciIndex = result.indexOf('### CI');
      expect(bugFixesIndex).toBeGreaterThanOrEqual(0);
      expect(featuresIndex).toBeGreaterThan(bugFixesIndex);
      expect(ciIndex).toBeGreaterThan(featuresIndex);
    });

    it('places unknown titles after known titles preserving their relative order', () => {
      const entry: ChangelogEntry = {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          { title: 'Unknown2', audience: 'all', items: [{ description: 'u2' }] },
          { title: 'Features', audience: 'all', items: [{ description: 'f' }] },
          { title: 'Unknown1', audience: 'all', items: [{ description: 'u1' }] },
          { title: 'Bug fixes', audience: 'all', items: [{ description: 'b' }] },
        ],
      };
      const result = renderReleaseNotesSingle(entry, {
        sectionOrder: ['Bug fixes', 'Features'],
      });
      const order = ['### Bug fixes', '### Features', '### Unknown2', '### Unknown1'].map((heading) =>
        result.indexOf(heading),
      );
      expect(order.every((index) => index >= 0)).toBe(true);
      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toBeGreaterThan(order[i - 1] ?? -1);
      }
    });

    it('preserves entry order when sectionOrder is absent', () => {
      const result = renderReleaseNotesSingle(sampleEntry);
      const featuresIndex = result.indexOf('### Features');
      const bugFixesIndex = result.indexOf('### Bug fixes');
      const ciIndex = result.indexOf('### CI');
      expect(featuresIndex).toBeLessThan(bugFixesIndex);
      expect(bugFixesIndex).toBeLessThan(ciIndex);
    });
  });

  describe('body rendering', () => {
    it('renders a single-paragraph body as a two-space-indented block under the bullet', () => {
      const entry: ChangelogEntry = {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [{ description: 'Add widget', body: 'Body paragraph explaining the feature.' }],
          },
        ],
      };
      const result = renderReleaseNotesSingle(entry, { includeHeading: false });
      expect(result).toContain('- Add widget\n\n  Body paragraph explaining the feature.');
    });

    it('renders a multi-paragraph body preserving internal blank lines with indentation', () => {
      const entry: ChangelogEntry = {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [{ description: 'Add widget', body: 'First paragraph.\n\nSecond paragraph.' }],
          },
        ],
      };
      const result = renderReleaseNotesSingle(entry, { includeHeading: false });
      expect(result).toContain('- Add widget\n\n  First paragraph.\n\n  Second paragraph.');
    });

    it('does not render a body block for items without a body', () => {
      const entry: ChangelogEntry = {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [{ description: 'Plain item' }],
          },
        ],
      };
      const result = renderReleaseNotesSingle(entry, { includeHeading: false });
      expect(result).toBe('### Features\n\n- Plain item\n');
    });

    it('mixes body-bearing and body-less items and omits trailing blank line after final body', () => {
      const entry: ChangelogEntry = {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [
          {
            title: 'Features',
            audience: 'all',
            items: [
              { description: 'With body', body: 'A detailed explanation.' },
              { description: 'No body' },
              { description: 'Another with body', body: 'Another detail.' },
            ],
          },
        ],
      };
      const result = renderReleaseNotesSingle(entry, { includeHeading: false });
      expect(result).toBe(
        '### Features\n\n- With body\n\n  A detailed explanation.\n\n- No body\n- Another with body\n\n  Another detail.\n',
      );
    });
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
