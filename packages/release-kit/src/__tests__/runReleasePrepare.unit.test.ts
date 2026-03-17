import assert from 'node:assert';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReleasePrepareMono = vi.hoisted(() => vi.fn());
const mockReleasePrepare = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('../releasePrepareMono.ts', () => ({
  releasePrepareMono: mockReleasePrepareMono,
}));

vi.mock('../releasePrepare.ts', () => ({
  releasePrepare: mockReleasePrepare,
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

import { RELEASE_TAGS_FILE, runReleasePrepare } from '../runReleasePrepare.ts';
import type { MonorepoReleaseConfig, ReleaseConfig, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    components: [
      {
        dir: 'arrays',
        tagPrefix: 'arrays-v',
        packageFiles: ['packages/arrays/package.json'],
        changelogPaths: ['packages/arrays'],
        paths: ['packages/arrays/**'],
      },
      {
        dir: 'strings',
        tagPrefix: 'strings-v',
        packageFiles: ['packages/strings/package.json'],
        changelogPaths: ['packages/strings'],
        paths: ['packages/strings/**'],
      },
    ],
    workTypes,
    ...overrides,
  };
}

function makeSingleConfig(overrides?: Partial<ReleaseConfig>): ReleaseConfig {
  return {
    tagPrefix: 'v',
    packageFiles: ['package.json'],
    changelogPaths: ['.'],
    workTypes,
    ...overrides,
  };
}

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(runReleasePrepare, () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    // Default return values: no tags (empty release)
    mockReleasePrepare.mockReturnValue([]);
    mockReleasePrepareMono.mockReturnValue([]);
    // Mock process.exit to throw so we can assert on it
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    mockReleasePrepareMono.mockReset();
    mockReleasePrepare.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('calls releasePrepareMono with dryRun false when no args are given', () => {
    process.argv = ['node', 'script.ts'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.objectContaining({ components: expect.any(Array) }), {
      dryRun: false,
      force: false,
    });
  });

  it('passes dryRun true when --dry-run is provided', () => {
    process.argv = ['node', 'script.ts', '--dry-run'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: true,
      force: false,
    });
  });

  it('passes bumpOverride when --bump is provided', () => {
    process.argv = ['node', 'script.ts', '--bump=major'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      force: false,
      bumpOverride: 'major',
    });
  });

  it('combines --dry-run and --bump', () => {
    process.argv = ['node', 'script.ts', '--dry-run', '--bump=patch'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: true,
      force: false,
      bumpOverride: 'patch',
    });
  });

  it('filters components when --only is provided', () => {
    process.argv = ['node', 'script.ts', '--only=arrays'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
    );
  });

  it('filters to multiple components when --only has comma-separated names', () => {
    process.argv = ['node', 'script.ts', '--only=arrays,strings'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({ tagPrefix: 'arrays-v' }),
          expect.objectContaining({ tagPrefix: 'strings-v' }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('passes force true when --force and --bump are provided', () => {
    process.argv = ['node', 'script.ts', '--force', '--bump=patch'];

    runReleasePrepare(makeConfig());

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      force: true,
      bumpOverride: 'patch',
    });
  });

  it('exits with code 1 when --force is used without --bump', () => {
    process.argv = ['node', 'script.ts', '--force'];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--force requires --bump'));
  });

  it('exits with code 1 for an invalid bump type', () => {
    process.argv = ['node', 'script.ts', '--bump=invalid'];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid bump type'));
  });

  it('exits with code 1 for an unknown component name in --only', () => {
    process.argv = ['node', 'script.ts', '--only=nonexistent'];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown component'));
  });

  it('exits with code 1 for an unknown argument', () => {
    process.argv = ['node', 'script.ts', '--foo'];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown argument'));
  });

  it('exits with code 0 when --help is provided', () => {
    process.argv = ['node', 'script.ts', '--help'];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('npx @williamthorsen/release-kit prepare'));
  });

  it('exits with code 1 when releasePrepareMono throws', () => {
    process.argv = ['node', 'script.ts'];
    mockReleasePrepareMono.mockImplementation(() => {
      throw new Error('something went wrong');
    });

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith('Error preparing release:', 'something went wrong');
  });

  it('exits with code 1 when --only value is empty', () => {
    process.argv = ['node', 'script.ts', '--only='];

    expect(() => runReleasePrepare(makeConfig())).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--only requires'));
  });

  describe('release-tags file', () => {
    it('writes to tmp/ relative to the project root', () => {
      expect(RELEASE_TAGS_FILE).toBe('tmp/.release-tags');
    });

    it('creates the parent directory before writing', () => {
      process.argv = ['node', 'script.ts'];
      mockReleasePrepareMono.mockReturnValue(['arrays-v1.1.0']);

      runReleasePrepare(makeConfig());

      expect(mockMkdirSync).toHaveBeenCalledWith('tmp', { recursive: true });

      // Verify mkdir was called before writeFileSync
      const mkdirOrder = mockMkdirSync.mock.invocationCallOrder[0];
      const writeOrder = mockWriteFileSync.mock.invocationCallOrder[0];
      assert.ok(mkdirOrder, 'mkdirSync was not called');
      assert.ok(writeOrder, 'writeFileSync was not called');
      expect(mkdirOrder).toBeLessThan(writeOrder);
    });

    it('writes .release-tags after a monorepo release', () => {
      process.argv = ['node', 'script.ts'];
      mockReleasePrepareMono.mockReturnValue(['arrays-v1.1.0', 'strings-v2.0.1']);

      runReleasePrepare(makeConfig());

      expect(mockWriteFileSync).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.1.0\nstrings-v2.0.1', 'utf8');
    });

    it('writes .release-tags after a single-package release', () => {
      process.argv = ['node', 'script.ts'];
      mockReleasePrepare.mockReturnValue(['v1.2.0']);

      runReleasePrepare(makeSingleConfig());

      expect(mockWriteFileSync).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'v1.2.0', 'utf8');
    });

    it('does not write .release-tags when no tags are produced', () => {
      process.argv = ['node', 'script.ts'];
      mockReleasePrepareMono.mockReturnValue([]);

      runReleasePrepare(makeConfig());

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('does not write .release-tags in dry-run mode', () => {
      process.argv = ['node', 'script.ts', '--dry-run'];
      mockReleasePrepareMono.mockReturnValue(['arrays-v1.1.0']);

      runReleasePrepare(makeConfig());

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe('single-package config', () => {
    it('calls releasePrepare for a single-package config', () => {
      process.argv = ['node', 'script.ts'];

      runReleasePrepare(makeSingleConfig());

      expect(mockReleasePrepare).toHaveBeenCalledWith(expect.objectContaining({ tagPrefix: 'v' }), {
        dryRun: false,
        force: false,
      });
      expect(mockReleasePrepareMono).not.toHaveBeenCalled();
    });

    it('passes dryRun and bumpOverride to releasePrepare', () => {
      process.argv = ['node', 'script.ts', '--dry-run', '--bump=minor'];

      runReleasePrepare(makeSingleConfig());

      expect(mockReleasePrepare).toHaveBeenCalledWith(expect.any(Object), {
        dryRun: true,
        force: false,
        bumpOverride: 'minor',
      });
    });

    it('exits with code 1 when --only is used with a single-package config', () => {
      process.argv = ['node', 'script.ts', '--only=foo'];

      expect(() => runReleasePrepare(makeSingleConfig())).toThrow(ExitError);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--only is only supported for monorepo'));
    });

    it('exits with code 1 when releasePrepare throws', () => {
      process.argv = ['node', 'script.ts'];
      mockReleasePrepare.mockImplementation(() => {
        throw new Error('single-package error');
      });

      expect(() => runReleasePrepare(makeSingleConfig())).toThrow(ExitError);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith('Error preparing release:', 'single-package error');
    });
  });
});
