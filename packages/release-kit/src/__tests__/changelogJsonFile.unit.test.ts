import { describe, expect, it } from 'vitest';

import { renderChangelogJson, resolveChangelogJsonPath } from '../changelogJsonFile.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';

describe(renderChangelogJson, () => {
  it('orders entries newest-first regardless of input order', () => {
    const rendered = renderChangelogJson([
      { version: '1.0.0', date: '2024-01-01', sections: [] },
      { version: '2.0.0', date: '2024-02-01', sections: [] },
    ]);

    const parsed: unknown = JSON.parse(rendered);
    expect(parsed).toStrictEqual([
      { version: '2.0.0', date: '2024-02-01', sections: [] },
      { version: '1.0.0', date: '2024-01-01', sections: [] },
    ]);
  });

  it('ends with a trailing newline', () => {
    expect(renderChangelogJson([{ version: '1.0.0', date: '2024-01-01', sections: [] }])).toMatch(/\n$/);
  });

  it('renders an empty entry list as an empty array', () => {
    expect(renderChangelogJson([])).toBe('[]\n');
  });
});

describe(resolveChangelogJsonPath, () => {
  it('joins the changelog path with the config-supplied output path', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: '.meta/changelog.json' } };
    expect(resolveChangelogJsonPath(config, 'packages/arrays')).toBe('packages/arrays/.meta/changelog.json');
  });

  it('honours a custom outputPath', () => {
    const config = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, outputPath: 'docs/changelog.json' } };
    expect(resolveChangelogJsonPath(config, '.')).toBe('docs/changelog.json');
  });
});
