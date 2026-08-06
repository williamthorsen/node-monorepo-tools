import { isFlatChecklist, type RdyCheck } from 'readyup';
import type { Workspace } from 'readyup/check-utils';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

const { mockedDiscoverWorkspaces, mockedFileContains, mockedFileExists, mockedReadFile } = vi.hoisted(() => ({
  mockedDiscoverWorkspaces: vi.fn<() => Workspace[]>(),
  mockedFileContains: vi.fn<(path: string, pattern: RegExp) => boolean>(),
  mockedFileExists: vi.fn<(path: string) => boolean>(),
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    discoverWorkspaces: mockedDiscoverWorkspaces,
    fileContains: mockedFileContains,
    fileExists: mockedFileExists,
    readFile: mockedReadFile,
  };
});

import kit, {
  configFileExportsConfig,
  readmeHasReleaseNotesMarkers,
  readmesHaveReleaseNotesMarkers,
} from '../../.readyup/kits/default.ts';

const CONFIG_GATE = '.config/release-kit.config.ts exports a config';

describe(configFileExportsConfig, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when the config file is absent', () => {
    mockedReadFile.mockReturnValue(undefined);

    expect(configFileExportsConfig()).toBe(false);
  });

  it.each([
    ['a default export', 'export default defineConfig({});\n'],
    ['a named config export', 'export const config = defineConfig({});\n'],
  ])('returns true for %s', (_label, content) => {
    mockedReadFile.mockReturnValue(content);

    expect(configFileExportsConfig()).toBe(true);
  });

  it('returns false when the file exports neither shape', () => {
    mockedReadFile.mockReturnValue('export const releaseKitConfig = defineConfig({});\n');

    expect(configFileExportsConfig()).toBe(false);
  });
});

// The gate is what collapses a config-less repo's report to one line: readyup runs, reports, and counts nothing
// beneath a check whose `skip` fires, so every check that reads the config file has to hang below it.
describe('release-kit config gate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

describe(readmeHasReleaseNotesMarkers, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when both opening and closing markers are present', () => {
    const content = '# Title\n<!-- section:release-notes -->\nNotes here\n<!-- /section:release-notes -->\n';

    expect(readmeHasReleaseNotesMarkers(content)).toBe(true);
  });

  it('returns false when only the opening marker is present', () => {
    const content = '# Title\n<!-- section:release-notes -->\nNotes here\n';

    expect(readmeHasReleaseNotesMarkers(content)).toBe(false);
  });

  it('returns false when only the closing marker is present', () => {
    const content = '# Title\nNotes here\n<!-- /section:release-notes -->\n';

    expect(readmeHasReleaseNotesMarkers(content)).toBe(false);
  });

  it('returns false when neither marker is present', () => {
    expect(readmeHasReleaseNotesMarkers('# Title\nJust some content.\n')).toBe(false);
  });
});

describe(readmesHaveReleaseNotesMarkers, () => {
  describe('single-package mode', () => {
    it('returns true when root README contains both markers', () => {
      mockedDiscoverWorkspaces.mockReturnValue([createWorkspaceAt('.')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'README.md') return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('reports the missing root README in CheckOutcome.detail', () => {
      mockedDiscoverWorkspaces.mockReturnValue([createWorkspaceAt('.')]);
      mockedReadFile.mockReturnValue(undefined);

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });

    it('reports the root README path when markers are missing', () => {
      mockedDiscoverWorkspaces.mockReturnValue([createWorkspaceAt('.')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'README.md') return '# Plain README';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });
  });

  describe('monorepo mode', () => {
    it('returns true when every workspace package README has both markers', () => {
      mockedDiscoverWorkspaces.mockReturnValue([
        createWorkspaceAt('packages/alpha'),
        createWorkspaceAt('packages/beta'),
      ]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        if (path === 'packages/beta/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('aggregates failing packages into CheckOutcome.detail', () => {
      mockedDiscoverWorkspaces.mockReturnValue([
        createWorkspaceAt('packages/alpha'),
        createWorkspaceAt('packages/beta'),
        createWorkspaceAt('packages/gamma'),
      ]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        if (path === 'packages/beta/README.md') return '# Plain README, no markers';
        // gamma README missing entirely
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: packages/beta/README.md, packages/gamma/README.md',
      });
    });

    it('returns true when there are no publishable packages', () => {
      mockedDiscoverWorkspaces.mockReturnValue([]);

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });
  });
});

// region | Helpers

/** Build a minimal Workspace-shaped fixture for tests. */
function createWorkspaceAt(dir: string): Workspace {
  return {
    dir,
    absolutePath: `/abs/${dir}`,
    name: dir === '.' ? 'consumer' : dir.replace(/^packages\//, ''),
    isPackage: true,
    packageJson: {},
  };
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
