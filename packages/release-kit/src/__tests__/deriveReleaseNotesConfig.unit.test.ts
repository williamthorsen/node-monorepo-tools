import { describe, expect, it } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { deriveReleaseNotesConfig } from '../deriveReleaseNotesConfig.ts';

const defaultSectionOrder = Object.values(DEFAULT_WORK_TYPES).map((entry) => entry.header);

describe(deriveReleaseNotesConfig, () => {
  it('returns the defaults when there is no config', () => {
    expect(deriveReleaseNotesConfig(undefined)).toStrictEqual({
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
      sectionOrder: defaultSectionOrder,
    });
  });

  it('returns the defaults for a config that sets none of the release-notes fields', () => {
    expect(deriveReleaseNotesConfig({})).toStrictEqual(deriveReleaseNotesConfig(undefined));
  });

  it('takes each release-notes field from the config', () => {
    const result = deriveReleaseNotesConfig({
      releaseNotes: { shouldInjectIntoReadme: true },
      changelogJson: { outputPath: 'custom/changelog.json' },
      workTypes: { fix: { header: 'Fixes' }, chore: { header: 'Chores' } },
    });

    expect(result.releaseNotes).toStrictEqual({ ...DEFAULT_RELEASE_NOTES_CONFIG, shouldInjectIntoReadme: true });
    expect(result.changelogJsonOutputPath).toBe('custom/changelog.json');
    // A configured key keeps its default position; a new key is appended.
    const fixIndex = Object.keys(DEFAULT_WORK_TYPES).indexOf('fix');
    expect(result.sectionOrder[fixIndex]).toBe('Fixes');
    expect(result.sectionOrder).toHaveLength(defaultSectionOrder.length + 1);
    expect(result.sectionOrder.at(-1)).toBe('Chores');
  });
});
