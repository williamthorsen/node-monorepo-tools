import { afterEach, describe, expect, it, vi } from 'vitest';

// Minimal Dirent-shape covering the fields the kit reads. Using a structural
// type avoids importing Dirent and casting through `unknown`, which the
// repo's lint rules disallow.
interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

const { mockedExistsSync, mockedReaddirSync, mockedReadFile } = vi.hoisted(() => ({
  mockedExistsSync: vi.fn<(path: string) => boolean>(),
  mockedReaddirSync: vi.fn<(path: string, options: { withFileTypes: true }) => DirentLike[]>(),
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: { ...actual, existsSync: mockedExistsSync, readdirSync: mockedReaddirSync },
    existsSync: mockedExistsSync,
    readdirSync: mockedReaddirSync,
  };
});

vi.mock('readyup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup')>();
  return {
    ...actual,
    readFile: mockedReadFile,
  };
});

import {
  getPublishablePackages,
  readmeHasReleaseNotesMarkers,
  readmesHaveReleaseNotesMarkers,
} from '../release-kit.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a minimal Dirent-shaped object for a directory entry. */
function dirEntry(name: string): DirentLike {
  return { name, isDirectory: () => true, isFile: () => false };
}

/** Build a Dirent-shaped object for a non-directory entry. */
function fileEntry(name: string): DirentLike {
  return { name, isDirectory: () => false, isFile: () => true };
}

describe(getPublishablePackages, () => {
  it('returns [] when packages/ does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(getPublishablePackages()).toEqual([]);
    expect(mockedReaddirSync).not.toHaveBeenCalled();
  });

  it('returns all packages whose package.json is not marked private', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('beta'), dirEntry('gamma')]);
    mockedReadFile.mockImplementation((path) => {
      if (path === 'packages/alpha/package.json') return JSON.stringify({ name: '@scope/alpha' });
      if (path === 'packages/beta/package.json') return JSON.stringify({ name: '@scope/beta', private: false });
      if (path === 'packages/gamma/package.json') return JSON.stringify({ name: '@scope/gamma' });
      return undefined;
    });

    expect(getPublishablePackages()).toEqual([
      { dir: 'packages/alpha' },
      { dir: 'packages/beta' },
      { dir: 'packages/gamma' },
    ]);
  });

  it('excludes packages with "private": true', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('hidden')]);
    mockedReadFile.mockImplementation((path) => {
      if (path === 'packages/alpha/package.json') return JSON.stringify({ name: '@scope/alpha' });
      if (path === 'packages/hidden/package.json') return JSON.stringify({ name: '@scope/hidden', private: true });
      return undefined;
    });

    expect(getPublishablePackages()).toEqual([{ dir: 'packages/alpha' }]);
  });

  it('skips entries that are not directories', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('alpha'), fileEntry('README.md')]);
    mockedReadFile.mockReturnValue(JSON.stringify({ name: '@scope/alpha' }));

    expect(getPublishablePackages()).toEqual([{ dir: 'packages/alpha' }]);
  });

  it('skips directories without a package.json', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('orphan')]);
    mockedReadFile.mockImplementation((path) => {
      if (path === 'packages/alpha/package.json') return JSON.stringify({ name: '@scope/alpha' });
      return undefined;
    });

    expect(getPublishablePackages()).toEqual([{ dir: 'packages/alpha' }]);
  });

  it('treats unparseable package.json as non-private (publishable)', () => {
    // parseJsonRecord returns undefined for invalid JSON; we treat that as
    // "no private field" so the package is included rather than silently dropped.
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('garbled')]);
    mockedReadFile.mockReturnValue('not valid JSON');

    expect(getPublishablePackages()).toEqual([{ dir: 'packages/garbled' }]);
  });

  it('does not treat string "true" as private', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([dirEntry('alpha')]);
    mockedReadFile.mockReturnValue(JSON.stringify({ private: 'true' }));

    expect(getPublishablePackages()).toEqual([{ dir: 'packages/alpha' }]);
  });
});

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
      mockedExistsSync.mockReturnValue(false); // pnpm-workspace.yaml absent
      mockedReadFile.mockImplementation((path) => {
        if (path === 'package.json') return JSON.stringify({ name: 'consumer' });
        if (path === 'README.md') return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('returns false when root README is missing', () => {
      mockedExistsSync.mockReturnValue(false);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'package.json') return JSON.stringify({ name: 'consumer' });
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(false);
    });

    it('returns false when root README lacks markers', () => {
      mockedExistsSync.mockReturnValue(false);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'package.json') return JSON.stringify({ name: 'consumer' });
        if (path === 'README.md') return '# Plain README';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(false);
    });
  });

  describe('monorepo mode', () => {
    it('returns true when every publishable package README has both markers', () => {
      mockedExistsSync.mockReturnValue(true); // pnpm-workspace.yaml present → monorepo
      mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('beta')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/package.json') return JSON.stringify({ name: 'alpha' });
        if (path === 'packages/beta/package.json') return JSON.stringify({ name: 'beta' });
        if (path === 'packages/alpha/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        if (path === 'packages/beta/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('aggregates failing packages into CheckOutcome.detail', () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('beta'), dirEntry('gamma')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/package.json') return JSON.stringify({ name: 'alpha' });
        if (path === 'packages/beta/package.json') return JSON.stringify({ name: 'beta' });
        if (path === 'packages/gamma/package.json') return JSON.stringify({ name: 'gamma' });
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

    it('skips packages marked private', () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([dirEntry('alpha'), dirEntry('hidden')]);
      mockedReadFile.mockImplementation((path) => {
        if (path === 'packages/alpha/package.json') return JSON.stringify({ name: 'alpha' });
        if (path === 'packages/hidden/package.json') return JSON.stringify({ name: 'hidden', private: true });
        if (path === 'packages/alpha/README.md')
          return '<!-- section:release-notes -->\n<!-- /section:release-notes -->';
        // hidden has no README — would fail if not filtered out
        return undefined;
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('returns true when there are no publishable packages', () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([]);

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });
  });
});
