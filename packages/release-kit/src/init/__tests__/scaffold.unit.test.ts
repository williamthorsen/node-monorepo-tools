import { afterEach, describe, expect, it, vi } from 'vitest';

const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { scaffoldFiles } from '../scaffold.ts';

describe('scaffold', () => {
  afterEach(() => {
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

    it('creates workflow, publish, create-github-release, and config files when withConfig is true', () => {
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.github/workflows/create-github-release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/publish.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/release.yaml', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.config/release-kit.config.ts', outcome: 'created' });

      const results = scaffoldFiles({
        repoType: 'single-package',
        dryRun: false,
        overwrite: false,
        withConfig: true,
      });

      expect(results.map((result) => result.filePath)).toStrictEqual([
        '.github/workflows/create-github-release.yaml',
        '.github/workflows/publish.yaml',
        '.github/workflows/release.yaml',
        '.config/release-kit.config.ts',
      ]);
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
});
