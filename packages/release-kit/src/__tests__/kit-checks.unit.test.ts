import { isFlatChecklist, type RdyCheck } from 'readyup';
import { assert, describe, expect, it, vi } from 'vitest';

const { mockedFileContains, mockedFileExists, mockedReadFile } = vi.hoisted(() => ({
  mockedFileContains: vi.fn<(path: string, pattern: RegExp) => boolean>(),
  mockedFileExists: vi.fn<(path: string) => boolean>(),
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    fileContains: mockedFileContains,
    fileExists: mockedFileExists,
    readFile: mockedReadFile,
  };
});

import kit, { configFileExportsConfig } from '../../.readyup/kits/default.ts';

const CONFIG_GATE = '.config/release-kit.config.ts exports a config';

describe(configFileExportsConfig, () => {
  it('returns false when the config file is absent', () => {
    mockedReadFile.mockReturnValue(undefined);

    expect(configFileExportsConfig()).toBe(false);
  });

  // Each case is a shape `loadConfig` resolves off the module namespace via `imported.default ?? imported.config`.
  // Rejecting one blocks the five checks nested beneath the gate, so the whole set has to pass.
  it.each([
    ['a default export', 'export default defineConfig({});\n'],
    ['a const config export', 'export const config = defineConfig({});\n'],
    ['a let config export', 'export let config = defineConfig({});\n'],
    ['a var config export', 'export var config = defineConfig({});\n'],
    ['a brace config export', 'const config = defineConfig({});\nexport { config };\n'],
    ['a multi-line brace config export', 'const config = defineConfig({});\nexport {\n  config,\n};\n'],
    ['an aliased default export', 'const cfg = defineConfig({});\nexport { cfg as default };\n'],
    ['an aliased config export', 'const cfg = defineConfig({});\nexport { cfg as config };\n'],
    ['a re-exported default', "export { default } from './release-kit.base.ts';\n"],
    ['a star re-export', "export * from './release-kit.base.ts';\n"],
  ])('returns true for %s', (_label, content) => {
    mockedReadFile.mockReturnValue(content);

    expect(configFileExportsConfig()).toBe(true);
  });

  it.each([
    ['the config is exported under another name', 'export const releaseKitConfig = defineConfig({});\n'],
    ['nothing is exported', 'const config = defineConfig({});\n'],
    ['only an unrelated binding is brace-exported', 'const other = 1;\nexport { other };\n'],
  ])('returns false when %s', (_label, content) => {
    mockedReadFile.mockReturnValue(content);

    expect(configFileExportsConfig()).toBe(false);
  });
});

// The gate is what collapses a config-less repo's report to one line: readyup runs, reports, and counts nothing
// beneath a check whose `skip` fires, so every check that reads the config file has to hang below it.
describe('release-kit config gate', () => {
  it('reports the gate as an error', () => {
    expect(getConfigGate().severity).toBe('error');
  });

  it('skips the gate when the config file is absent', () => {
    mockedFileExists.mockReturnValue(false);

    expect(getConfigGate().skip?.()).toBe('no release-kit config file');
  });

  it('runs the gate when the config file is present', () => {
    mockedFileExists.mockReturnValue(true);

    expect(getConfigGate().skip?.()).toBe(false);
  });

  it('hangs every config-dependent check beneath the gate', () => {
    const childNames = getConfigGate().checks?.map((check) => check.name);

    expect(childNames).toStrictEqual([
      'releaseNotes config is consistent with changelogJson',
      '.config/release-kit.config.ts uses defineConfig',
      'releaseNotes.shouldInjectIntoReadme is true',
      'repoLabels block declared in .config/release-kit.config.ts',
      '.github/labels.yaml exists',
    ]);
  });

  // A nested check repeating the gate's own skip is what produced the extra lines this gate collapses.
  it('declares no skip on a nested check other than .github/labels.yaml exists', () => {
    const skipping = (getConfigGate().checks ?? [])
      .filter((check) => check.skip !== undefined)
      .map((check) => check.name);

    expect(skipping).toStrictEqual(['.github/labels.yaml exists']);
  });

  it('skips .github/labels.yaml exists when no repoLabels block is declared', () => {
    mockedFileContains.mockReturnValue(false);

    expect(findCheck('.github/labels.yaml exists', getConfigGate().checks ?? []).skip?.()).toBe('no repoLabels config');
  });

  it('runs .github/labels.yaml exists when a repoLabels block is declared', () => {
    mockedFileContains.mockReturnValue(true);

    expect(findCheck('.github/labels.yaml exists', getConfigGate().checks ?? []).skip?.()).toBe(false);
  });
});

// region | Helpers

/**
 * Finds a check by name among `siblings`, asserting it exists so a rename fails loudly.
 *
 * The caller names the level to search rather than getting a tree walk. Reading the name of every check would fire
 * the `@williamthorsen/release-kit >= x` name getter, whose compile-time-only `pickJson` throws against the
 * uncompiled source this suite imports.
 */
function findCheck(name: string, siblings: RdyCheck[]): RdyCheck {
  const check = siblings.find((candidate) => candidate.name === name);
  assert(check, `Expected a "${name}" check`);
  return check;
}

/** Returns the check that every config-dependent check hangs beneath. */
function getConfigGate(): RdyCheck {
  return findCheck(CONFIG_GATE, getReleaseKitChecks());
}

/** Returns the top-level checks of the kit's `release-kit` checklist. */
function getReleaseKitChecks(): RdyCheck[] {
  const checklist = kit.checklists.find((candidate) => candidate.name === 'release-kit');
  assert(checklist && isFlatChecklist(checklist), 'Expected the kit to carry a flat `release-kit` checklist');
  return checklist.checks;
}

// endregion | Helpers
