import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockFindPackageRoot = vi.hoisted(() => vi.fn().mockReturnValue('/fake/package'));
const mockPrintError = vi.hoisted(() => vi.fn());
const mockPrintSkip = vi.hoisted(() => vi.fn());
const mockPrintSuccess = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('../../findPackageRoot.ts'), () => ({
  findPackageRoot: mockFindPackageRoot,
}));

vi.mock(import('../prompt.ts'), () => ({
  printError: mockPrintError,
  printSkip: mockPrintSkip,
  printSuccess: mockPrintSuccess,
}));

import { copyCliffTemplate, scaffoldFiles } from '../scaffold.ts';

describe('scaffold', () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockFindPackageRoot.mockReset().mockReturnValue('/fake/package');
    mockPrintError.mockReset();
    mockPrintSkip.mockReset();
    mockPrintSuccess.mockReset();
  });

  describe(scaffoldFiles, () => {
    it('creates only the workflow file by default', () => {
      mockExistsSync.mockReturnValue(false);

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false, withConfig: false });

      expect(mockMkdirSync).toHaveBeenCalledWith('.github/workflows', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        '.config/release-kit.config.ts',
        expect.any(String),
        expect.any(String),
      );
    });

    it('creates workflow and config files when withConfig is true', () => {
      mockExistsSync
        .mockReturnValueOnce(false) // workflow file exists?
        .mockReturnValueOnce(false) // config file exists?
        .mockReturnValueOnce(true) // template path exists?
        .mockReturnValueOnce(false); // .config/git-cliff.toml exists?
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "template"');

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false, withConfig: true });

      expect(mockMkdirSync).toHaveBeenCalledWith('.github/workflows', { recursive: true });
      expect(mockMkdirSync).toHaveBeenCalledWith('.config', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('.config/release-kit.config.ts', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '.config/git-cliff.toml',
        '[changelog]\nbody = "template"',
        'utf8',
      );
    });

    it('skips files that already exist with different content when overwrite is false', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('different content');

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false, withConfig: false });

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSkip).toHaveBeenCalledTimes(1);
    });

    it('overwrites existing files when overwrite is true', () => {
      mockExistsSync.mockReturnValue(true);

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: true, withConfig: false });

      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
      expect(mockPrintSkip).not.toHaveBeenCalled();
    });

    it('skips all files when withConfig is true, overwrite is false, and all targets have different content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        // Return template content for the bundled template read; return different content for file-existence reads.
        if (path.includes('cliff.toml.template')) return '[changelog]\nbody = "template"';
        return 'different content';
      });

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false, withConfig: true });

      expect(mockPrintSkip).toHaveBeenCalledWith(expect.stringContaining('.github/workflows/release.yaml'));
      expect(mockPrintSkip).toHaveBeenCalledWith(expect.stringContaining('.config/release-kit.config.ts'));
      expect(mockPrintSkip).toHaveBeenCalledWith(expect.stringContaining('.config/git-cliff.toml'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('overwrites cliff template when withConfig is true and overwrite is true', () => {
      // existsSync: workflow (true), template path (true), git-cliff.toml target (true)
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "overwritten"');

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: true, withConfig: true });

      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('.config/release-kit.config.ts', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '.config/git-cliff.toml',
        '[changelog]\nbody = "overwritten"',
        'utf8',
      );
      expect(mockPrintSkip).not.toHaveBeenCalled();
    });

    it('logs but does not write in dry-run mode', () => {
      mockExistsSync.mockReturnValue(false);

      scaffoldFiles({ repoType: 'single-package', dryRun: true, overwrite: false, withConfig: false });

      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });

    it('prints an error when mkdirSync fails for scaffold files', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false, withConfig: false });

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Failed to create directory for'));
    });
  });

  describe('content-aware skip reporting', () => {
    it('reports up to date when existing file matches the intended content', () => {
      // Template file exists, target file exists with same content
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('same content');

      copyCliffTemplate(false, false);

      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('(up to date)'));
      expect(mockPrintSkip).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('reports already exists when existing file differs from intended content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('cliff.toml.template')) return 'template content';
        return 'different content on disk';
      });

      copyCliffTemplate(false, false);

      expect(mockPrintSkip).toHaveBeenCalledWith(expect.stringContaining('(already exists)'));
      expect(mockPrintSuccess).not.toHaveBeenCalled();
    });

    it('treats files as identical when they differ only in trailing whitespace', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('cliff.toml.template')) return 'line one\nline two\n';
        return 'line one  \nline two  \n\n';
      });

      copyCliffTemplate(false, false);

      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('(up to date)'));
      expect(mockPrintSkip).not.toHaveBeenCalled();
    });

    it('falls back to already exists when reading the existing file throws', () => {
      let callCount = 0;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('cliff.toml.template')) return 'template content';
        callCount++;
        if (callCount === 1) throw new Error('EACCES: permission denied');
        return 'unreachable';
      });

      copyCliffTemplate(false, false);

      expect(mockPrintSkip).toHaveBeenCalledWith(expect.stringContaining('(already exists)'));
      expect(mockPrintSuccess).not.toHaveBeenCalled();
    });

    it('reports up to date in dry-run mode when existing file matches', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('same content');

      copyCliffTemplate(true, false);

      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('(up to date)'));
      expect(mockPrintSkip).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe(copyCliffTemplate, () => {
    it('prints an error when the template file is not found', () => {
      mockExistsSync.mockReturnValue(false);

      copyCliffTemplate(false, false);

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Could not find cliff.toml.template'));
    });

    it('reads the template and writes .config/git-cliff.toml when template exists', () => {
      // First call: existsSync for templatePath (true), second: existsSync for .config/git-cliff.toml (false)
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "template content"');

      copyCliffTemplate(false, false);

      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining('cliff.toml.template'), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '.config/git-cliff.toml',
        '[changelog]\nbody = "template content"',
        'utf8',
      );
    });

    it('prints an error when readFileSync fails for the template', () => {
      mockExistsSync.mockReturnValueOnce(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      copyCliffTemplate(false, false);

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Failed to read cliff.toml.template'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('does not write in dry-run mode', () => {
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValue('template content');

      copyCliffTemplate(true, false);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });
  });
});
