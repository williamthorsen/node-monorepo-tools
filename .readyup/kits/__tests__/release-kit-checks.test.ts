import type { Workspace } from 'readyup';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockedDiscoverWorkspaces, mockedReadFile } = vi.hoisted(() => ({
  mockedDiscoverWorkspaces: vi.fn<() => Workspace[]>(),
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock('readyup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup')>();
  return {
    ...actual,
    discoverWorkspaces: mockedDiscoverWorkspaces,
    readFile: mockedReadFile,
  };
});

import { readmeHasReleaseNotesMarkers, readmesHaveReleaseNotesMarkers } from '../release-kit.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a minimal Workspace-shaped fixture for tests. */
function workspaceAt(dir: string): Workspace {
  return {
    dir,
    absolutePath: `/abs/${dir}`,
    name: dir === '.' ? 'consumer' : dir.replace(/^packages\//, ''),
    isPackage: true,
    packageJson: {},
  };
}

describe(readmeHasReleaseNotesMarkers, () => {
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
      mockedDiscoverWorkspaces.mockReturnValue([workspaceAt('.')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'README.md') return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('reports the missing root README in CheckOutcome.detail', () => {
      mockedDiscoverWorkspaces.mockReturnValue([workspaceAt('.')]);
      mockedReadFile.mockReturnValue(undefined);

      expect(readmesHaveReleaseNotesMarkers()).toEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });

    it('reports the root README path when markers are missing', () => {
      mockedDiscoverWorkspaces.mockReturnValue([workspaceAt('.')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'README.md') return '# Plain README';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });
  });

  describe('monorepo mode', () => {
    it('returns true when every workspace package README has both markers', () => {
      mockedDiscoverWorkspaces.mockReturnValue([workspaceAt('packages/alpha'), workspaceAt('packages/beta')]);
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
        workspaceAt('packages/alpha'),
        workspaceAt('packages/beta'),
        workspaceAt('packages/gamma'),
      ]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        if (path === 'packages/beta/README.md') return '# Plain README, no markers';
        // gamma README missing entirely
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toEqual({
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
