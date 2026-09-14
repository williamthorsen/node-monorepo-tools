import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockFindPackageRoot = vi.hoisted(() => vi.fn().mockReturnValue('/fake/package'));
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  findPackageRoot: mockFindPackageRoot,
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { copyCliffTemplate, scaffoldFiles } from '../scaffold.ts';

describe('scaffold', () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockFindPackageRoot.mockReset().mockReturnValue('/fake/package');
    mockWriteFileWithCheck.mockReset();
  });

  describe(scaffoldFiles, () => {
    it('creates create-github-release, publish, and release workflow files by default', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'created' });

      const results = scaffoldFiles({
        repoType: 'single-package',
        dryRun: false,
        overwrite: false,
        withConfig: false,
      });

      expect(results).toHaveLength(3);
      expect(results[0]).toStrictEqual({
        filePath: '.github/workflows/create-github-release.yaml',
        outcome: 'created',
      });
      expect(results[1]).toStrictEqual({ filePath: '.github/workflows/publish.yaml', outcome: 'created' });
      expect(results[2]).toStrictEqual({ filePath: '.github/workflows/release.yaml', outcome: 'created' });
      expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(3);
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
        '.github/workflows/create-github-release.yaml',
        expect.any(String),
        { dryRun: false, overwrite: false },
      );
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), {
        dryRun: false,
        overwrite: false,
      });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/publish.yaml', expect.any(String), {
        dryRun: false,
        overwrite: false,
      });
    });

    it('scaffolds the monorepo tag pattern into create-github-release.yaml when repoType is monorepo', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'created' });

      scaffoldFiles({
        repoType: 'monorepo',
        dryRun: false,
        overwrite: false,
        withConfig: false,
      });

      const createReleaseCall = mockWriteFileWithCheck.mock.calls.find(
        (args) => args[0] === '.github/workflows/create-github-release.yaml',
      );
      expect(createReleaseCall?.[1]).toContain("'*-v[0-9]*.[0-9]*.[0-9]*'");
    });

    it('creates workflow, publish, create-github-release, config, and cliff template when withConfig is true', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.config/release-kit.config.ts', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.config/git-cliff.toml', outcome: 'created' });
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "template"');

      const results = scaffoldFiles({
        repoType: 'single-package',
        dryRun: false,
        overwrite: false,
        withConfig: true,
      });

      expect(results).toHaveLength(5);
      expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(5);
    });

    it('returns skipped results when overwrite is false and files exist', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'skipped' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'skipped' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'skipped' });

      const results = scaffoldFiles({
        repoType: 'single-package',
        dryRun: false,
        overwrite: false,
        withConfig: false,
      });

      expect(results).toHaveLength(3);
      expect(results[0]).toStrictEqual({
        filePath: '.github/workflows/create-github-release.yaml',
        outcome: 'skipped',
      });
      expect(results[1]).toStrictEqual({ filePath: '.github/workflows/publish.yaml', outcome: 'skipped' });
      expect(results[2]).toStrictEqual({ filePath: '.github/workflows/release.yaml', outcome: 'skipped' });
    });

    it('passes overwrite option to writeFileWithCheck', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'overwritten' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'overwritten' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'overwritten' });

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: true, withConfig: false });

      expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
        '.github/workflows/create-github-release.yaml',
        expect.any(String),
        { dryRun: false, overwrite: true },
      );
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), {
        dryRun: false,
        overwrite: true,
      });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/publish.yaml', expect.any(String), {
        dryRun: false,
        overwrite: true,
      });
    });

    it('returns dry-run outcomes without writing', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'created' });

      const results = scaffoldFiles({
        repoType: 'single-package',
        dryRun: true,
        overwrite: false,
        withConfig: false,
      });

      expect(results).toHaveLength(3);
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
        '.github/workflows/create-github-release.yaml',
        expect.any(String),
        { dryRun: true, overwrite: false },
      );
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), {
        dryRun: true,
        overwrite: false,
      });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/publish.yaml', expect.any(String), {
        dryRun: true,
        overwrite: false,
      });
    });
  });

  describe(copyCliffTemplate, () => {
    it.each([
      ['the template file is missing', 'ENOENT: no such file or directory'],
      ['the template file is unreadable', 'EACCES: permission denied'],
    ])('returns failed naming the template path and the cause when %s', (_label, cause) => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error(cause);
      });

      const result = copyCliffTemplate(false, false);

      expect(result).toStrictEqual({
        filePath: '.config/git-cliff.toml',
        outcome: 'failed',
        error: `Failed to read bundled template at /fake/package/cliff.toml.template: ${cause}`,
      });
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    });

    it('returns failed with error when findPackageRoot throws', () => {
      mockFindPackageRoot.mockImplementation(() => {
        throw new Error('Could not find package root from /fake/path');
      });

      const result = copyCliffTemplate(false, false);

      expect(result).toStrictEqual({
        filePath: '.config/git-cliff.toml',
        outcome: 'failed',
        error: 'Failed to resolve package root: Could not find package root from /fake/path',
      });
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    });

    it('reads the template and delegates to writeFileWithCheck', () => {
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "template content"');
      mockWriteFileWithCheck.mockReturnValue({ filePath: '.config/git-cliff.toml', outcome: 'created' });

      const result = copyCliffTemplate(false, false);

      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining('cliff.toml.template'), 'utf8');
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
        '.config/git-cliff.toml',
        '[changelog]\nbody = "template content"',
        { dryRun: false, overwrite: false },
      );
      expect(result).toStrictEqual({ filePath: '.config/git-cliff.toml', outcome: 'created' });
    });

    it('passes dryRun and overwrite options through', () => {
      mockReadFileSync.mockReturnValue('template content');
      mockWriteFileWithCheck.mockReturnValue({ filePath: '.config/git-cliff.toml', outcome: 'overwritten' });

      copyCliffTemplate(true, true);

      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.config/git-cliff.toml', 'template content', {
        dryRun: true,
        overwrite: true,
      });
    });
  });
});
