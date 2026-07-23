import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { findPackageRoot } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { loadPreset } from '../presets.ts';

const presetsDir = resolve(findPackageRoot(import.meta.url), 'presets', 'labels');
const presetNames = readdirSync(presetsDir)
  .filter((file) => file.endsWith('.yaml'))
  .map((file) => basename(file, '.yaml'));

/**
 * Integrity check over the bundled preset data. Duplicate names within a preset are not a
 * runtime error — label resolution is a last-writer-wins fold — so this test is what keeps
 * a bundled preset from shipping a silently self-overwriting entry.
 */
describe('bundled label presets', () => {
  it('ships at least the common preset', () => {
    expect(presetNames).toContain('common');
  });

  it.each(presetNames)('preset "%s" defines each label name only once', (presetName) => {
    const names = loadPreset(presetName).map((label) => label.name);
    expect([...new Set(names)]).toStrictEqual(names);
  });
});
