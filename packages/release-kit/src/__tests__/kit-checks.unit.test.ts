import { isFlatChecklist, type RdyCheck } from 'readyup';
import type { Workspace } from 'readyup/check-utils';
import { assert, describe, expect, it, vi } from 'vitest';

const { mockedDiscoverWorkspaces, mockedFileContains, mockedFileExists, mockedHasDevDependency, mockedReadFile } =
  vi.hoisted(() => ({
    mockedDiscoverWorkspaces: vi.fn<() => Workspace[]>(() => []),
    mockedFileContains: vi.fn<(path: string, pattern: RegExp) => boolean>(),
    mockedFileExists: vi.fn<(path: string) => boolean>(),
    mockedHasDevDependency: vi.fn<(name: string) => boolean>(),
    mockedReadFile: vi.fn<(path: string) => string | undefined>(),
  }));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    discoverWorkspaces: mockedDiscoverWorkspaces,
    fileContains: mockedFileContains,
    fileExists: mockedFileExists,
    hasDevDependency: mockedHasDevDependency,
    readFile: mockedReadFile,
  };
});

import kit, { configFileExportsConfig } from '../../.readyup/kits/default.ts';

const CHANGELOG_CHECK = 'published packages ship CHANGELOG.md';
const CHANGELOG_JSON_GATE = 'changelog.json generation is enabled';
const CHANGESETS_CHECK = '@changesets/cli not in devDependencies';
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

// Both checks sit at the top level rather than beneath the config gate, which skips where the config file is
// absent. A repo with no config file inherits `changelogJson.enabled: true` and still publishes tarballs, so
// nesting them would mask exactly the repos the checks exist for.
describe('changelog packaging checks', () => {
  it('hangs neither check beneath the config gate', () => {
    const gateChildNames = getConfigGate().checks?.map((check) => check.name);

    expect(gateChildNames).not.toContain(CHANGELOG_CHECK);
    expect(gateChildNames).not.toContain(CHANGELOG_JSON_GATE);
  });

  it('reports a missing CHANGELOG.md at warn', () => {
    expect(getChangelogCheck().severity).toBe('warn');
  });

  // Disabling changelogJson is a declared opt-out rather than a defect, so it stays below the failing threshold.
  it('reports a disabled changelogJson at recommend', () => {
    expect(getChangelogJsonGate().severity).toBe('recommend');
  });

  it('reports a tarball missing the changelog JSON at warn', () => {
    expect(findCheck('published packages ship the changelog JSON', getChangelogJsonGate().checks ?? []).severity).toBe(
      'warn',
    );
  });

  it.each([
    ['the CHANGELOG.md check', () => getChangelogCheck()],
    ['the changelogJson gate', () => getChangelogJsonGate()],
  ])('skips %s where the repo publishes nothing', (_label, getCheck) => {
    mockedDiscoverWorkspaces.mockReturnValue([]);

    expect(getCheck().skip?.()).toBe('no publishable packages');
  });

  it.each([
    ['the CHANGELOG.md check', () => getChangelogCheck()],
    ['the changelogJson gate', () => getChangelogJsonGate()],
  ])('runs %s where the repo publishes a package', (_label, getCheck) => {
    mockedDiscoverWorkspaces.mockReturnValue([buildPublishableWorkspace()]);

    expect(getCheck().skip?.()).toBe(false);
  });

  // The gate's own skip already covers the nested check; repeating it is what produced the duplicate lines the
  // config gate's tests guard against.
  it('declares no skip on the nested check', () => {
    const nested = findCheck('published packages ship the changelog JSON', getChangelogJsonGate().checks ?? []);

    expect(nested.skip).toBeUndefined();
  });

  it('names the configured output path in the nested fix', () => {
    mockedReadFile.mockReturnValue('export default defineConfig({ changelogJson: { outputPath: "docs/cl.json" } });\n');
    const nested = findCheck('published packages ship the changelog JSON', getChangelogJsonGate().checks ?? []);

    expect(nested.fix).toBe('Add "docs/cl.json" to the files field of each affected package.json');
  });
});

describe(CHANGESETS_CHECK, () => {
  it('passes when @changesets/cli is absent', () => {
    mockedHasDevDependency.mockReturnValue(false);

    expect(getChangesetsCheck().check()).toBe(true);
  });

  // The mock keys on the name, so this case covers a mistyped package name as well as a dropped negation.
  it('fails when @changesets/cli is declared', () => {
    mockedHasDevDependency.mockImplementation((name) => name === '@changesets/cli');

    expect(getChangesetsCheck().check()).toBe(false);
  });

  it('reports at recommend, which leaves a default run passing', () => {
    expect(getChangesetsCheck().severity).toBe('recommend');
  });

  it('stays quiet where the package is absent', () => {
    expect(getChangesetsCheck().quiet).toBe(true);
  });
});

// region | Helpers

/**
 * Builds a publishable workspace for the mocked discovery to return.
 *
 * `hasPublishablePackages` reads the returned array's length and nothing else, so the field values are inert;
 * the shape is filled in because `discoverWorkspaces` promises it, not because a check reads it.
 */
function buildPublishableWorkspace(): Workspace {
  return { dir: '.', absolutePath: '/repo', name: 'solo', isPackage: true, isRoot: true, packageJson: {} };
}

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

/** Returns the check reporting a publishable workspace whose tarball would omit `CHANGELOG.md`. */
function getChangelogCheck(): RdyCheck {
  return findCheck(CHANGELOG_CHECK, getReleaseKitChecks());
}

/** Returns the check the changelog-JSON packaging check hangs beneath. */
function getChangelogJsonGate(): RdyCheck {
  return findCheck(CHANGELOG_JSON_GATE, getReleaseKitChecks());
}

/** Returns the check reporting a repo that still declares the superseded changesets CLI. */
function getChangesetsCheck(): RdyCheck {
  return findCheck(CHANGESETS_CHECK, getReleaseKitChecks());
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
