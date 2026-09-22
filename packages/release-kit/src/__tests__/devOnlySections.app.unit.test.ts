import { describe, expect, it } from 'vitest';

import { stripGroupDecorations } from '../buildChangelogEntries.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';

/**
 * Bare section names intended for all audiences (not dev-only).
 *
 * Comparison against the taxonomy's headers and the `devOnlySections` defaults is performed after
 * `stripEmojiPrefix` normalisation, so the contract this set expresses is "every section, regardless
 * of any decorative emoji prefix, is classified as either dev-only or all-audience by its bare name."
 */
const ALL_AUDIENCE_GROUPS = new Set(['Bug fixes', 'Deprecated', 'Features', 'Performance', 'Removed', 'Security']);

/** Bare names of the sections a changelog can carry: one per work type the taxonomy admits. */
function getChangelogSectionNames(): Set<string> {
  const names = new Set<string>();
  for (const config of Object.values(DEFAULT_WORK_TYPES)) {
    if (config.excludedFromChangelog === true) {
      continue;
    }
    names.add(stripGroupDecorations(config.header));
  }
  return names;
}

describe('devOnlySections drift detection', () => {
  const sectionNames = getChangelogSectionNames();
  const devOnlySectionsBare = new Set(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections.map(stripGroupDecorations));

  it('every devOnlySections default names a section the taxonomy admits', () => {
    for (const section of devOnlySectionsBare) {
      expect(sectionNames, `devOnlySections entry "${section}" is not a work-type header`).toContain(section);
    }
  });

  it('every section is classified as either dev-only or all-audience', () => {
    for (const section of sectionNames) {
      const isClassified = devOnlySectionsBare.has(section) || ALL_AUDIENCE_GROUPS.has(section);
      expect(
        isClassified,
        `Section "${section}" is not classified — add it to devOnlySections defaults or ALL_AUDIENCE_GROUPS`,
      ).toBe(true);
    }
  });

  it('no section appears in both devOnlySections and ALL_AUDIENCE_GROUPS', () => {
    for (const section of devOnlySectionsBare) {
      expect(
        ALL_AUDIENCE_GROUPS.has(section),
        `Section "${section}" appears in both devOnlySections and ALL_AUDIENCE_GROUPS`,
      ).toBe(false);
    }
  });
});
