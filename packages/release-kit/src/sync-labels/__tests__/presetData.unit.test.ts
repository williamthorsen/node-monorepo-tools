import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { CANONICAL_TAXONOMY } from '@williamthorsen/change-grammar';
import { findPackageRoot } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { loadPreset } from '../presets.ts';

const presetsDir = resolve(findPackageRoot(import.meta.url), 'presets', 'labels');
const presetNames = readdirSync(presetsDir)
  .filter((file) => file.endsWith('.yaml'))
  .map((file) => basename(file, '.yaml'));

/**
 * Integrity check over the bundled preset data. Duplicate names within a preset are not a
 * runtime error, because label resolution is a last-writer-wins fold; this test keeps a bundled
 * preset from including a silently self-overwriting entry. Names are compared case-insensitively,
 * as GitHub compares them.
 */
describe('bundled label presets', () => {
  it('bundles at least the common preset', () => {
    expect(presetNames).toContain('common');
  });

  it('defines the tracker label of every work type in the common preset', () => {
    const names = loadPreset('common').map((label) => label.name);

    for (const { trackerLabel } of CANONICAL_TAXONOMY.types) {
      expect(names).toContain(trackerLabel);
    }
  });

  it.each(presetNames)('preset "%s" defines each label name only once, ignoring case', (presetName) => {
    const lowercasedNames = loadPreset(presetName).map((label) => label.name.toLowerCase());
    expect([...new Set(lowercasedNames)]).toStrictEqual(lowercasedNames);
  });
});
