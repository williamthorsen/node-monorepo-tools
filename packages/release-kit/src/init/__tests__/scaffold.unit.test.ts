import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockFileURLToPath = vi.hoisted(() => vi.fn());
const mockPrintError = vi.hoisted(() => vi.fn());
const mockPrintSkip = vi.hoisted(() => vi.fn());
const mockPrintSuccess = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('node:url'), () => ({
  fileURLToPath: mockFileURLToPath,
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
    mockFileURLToPath.mockReset();
    mockPrintError.mockReset();
    mockPrintSkip.mockReset();
    mockPrintSuccess.mockReset();
  });

  describe(scaffoldFiles, () => {
    it('creates scaffold files when they do not exist', () => {
      mockExistsSync.mockReturnValue(false);

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false });

      expect(mockMkdirSync).toHaveBeenCalledWith('.config', { recursive: true });
      expect(mockMkdirSync).toHaveBeenCalledWith('.github/workflows', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith('.config/release-kit.config.ts', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
    });

    it('skips files that already exist when overwrite is false', () => {
      mockExistsSync.mockReturnValue(true);

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false });

      // writeIfAbsent should skip, not write
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSkip).toHaveBeenCalledTimes(2);
    });

    it('overwrites existing files when overwrite is true', () => {
      mockExistsSync.mockReturnValue(true);

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: true });

      // Should write files even though they exist
      expect(mockWriteFileSync).toHaveBeenCalledWith('.config/release-kit.config.ts', expect.any(String), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('.github/workflows/release.yaml', expect.any(String), 'utf8');
      expect(mockPrintSkip).not.toHaveBeenCalled();
    });

    it('logs but does not write in dry-run mode', () => {
      mockExistsSync.mockReturnValue(false);

      scaffoldFiles({ repoType: 'single-package', dryRun: true, overwrite: false });

      // mkdirSync and writeFileSync should not be called for the scaffold files
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });

    it('prints an error when mkdirSync fails for scaffold files', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      scaffoldFiles({ repoType: 'single-package', dryRun: false, overwrite: false });

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Failed to create directory for'));
    });
  });

  describe(copyCliffTemplate, () => {
    it('prints an error when the template file is not found', () => {
      mockFileURLToPath.mockReturnValue('/fake/dist/esm/init/scaffold.js');
      mockExistsSync.mockReturnValue(false);

      copyCliffTemplate(false);

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Could not find cliff.toml.template'));
    });

    it('reads the template and writes cliff.toml when template exists', () => {
      mockFileURLToPath.mockReturnValue('/fake/dist/esm/init/scaffold.js');
      // First call: existsSync for templatePath (true), second call: existsSync for cliff.toml (false)
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValue('[changelog]\nbody = "template content"');

      copyCliffTemplate(false);

      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining('cliff.toml.template'), 'utf8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('cliff.toml', '[changelog]\nbody = "template content"', 'utf8');
    });

    it('prints an error when readFileSync fails for the template', () => {
      mockFileURLToPath.mockReturnValue('/fake/dist/esm/init/scaffold.js');
      mockExistsSync.mockReturnValueOnce(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      copyCliffTemplate(false);

      expect(mockPrintError).toHaveBeenCalledWith(expect.stringContaining('Failed to read cliff.toml.template'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('does not write in dry-run mode', () => {
      mockFileURLToPath.mockReturnValue('/fake/dist/esm/init/scaffold.js');
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValue('template content');

      copyCliffTemplate(true);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockPrintSuccess).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    });
  });
});
