import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockFindPackageRoot = vi.hoisted(() => vi.fn().mockReturnValue('/fake/package'));
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  findPackageRoot: mockFindPackageRoot,
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { copyWorkflowTemplate, scaffoldFiles, scaffoldWorkflow } from '../scaffold.ts';

describe('scaffold', () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockFindPackageRoot.mockReset().mockReturnValue('/fake/package');
    mockWriteFileWithCheck.mockReset();
  });

  describe(copyWorkflowTemplate, () => {
    it('returns failed with error when the template file is not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = copyWorkflowTemplate(false, false);

      expect(result).toStrictEqual({
        filePath: '.github/workflows/audit.yaml',
        outcome: 'failed',
        error: expect.stringContaining('Could not find bundled template at'),
      });
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    });

    it('reads the template and delegates to writeFileWithCheck', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('name: Dependency audit\n');
      mockWriteFileWithCheck.mockReturnValue({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });

      const result = copyWorkflowTemplate(false, false);

      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining('audit.yaml.template'), 'utf8');
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/audit.yaml', 'name: Dependency audit\n', {
        dryRun: false,
        overwrite: false,
      });
      expect(result).toStrictEqual({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });
    });

    it('returns failed with error when readFileSync throws for the template', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = copyWorkflowTemplate(false, false);

      expect(result).toStrictEqual({
        filePath: '.github/workflows/audit.yaml',
        outcome: 'failed',
        error: expect.stringContaining('EACCES: permission denied'),
      });
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    });

    it('returns failed with error when findPackageRoot throws', () => {
      mockFindPackageRoot.mockImplementation(() => {
        throw new Error('Could not find package root from /fake/path');
      });

      const result = copyWorkflowTemplate(false, false);

      expect(result).toStrictEqual({
        filePath: '.github/workflows/audit.yaml',
        outcome: 'failed',
        error: expect.stringContaining('Could not find package root from /fake/path'),
      });
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    });

    it('passes dryRun and overwrite options through', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('template content');
      mockWriteFileWithCheck.mockReturnValue({ filePath: '.github/workflows/audit.yaml', outcome: 'overwritten' });

      copyWorkflowTemplate(true, true);

      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/audit.yaml', 'template content', {
        dryRun: true,
        overwrite: true,
      });
    });
  });

  describe(scaffoldWorkflow, () => {
    it('delegates to copyWorkflowTemplate and returns its result', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('name: Dependency audit\n');
      mockWriteFileWithCheck.mockReturnValue({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });

      const result = scaffoldWorkflow(false, false);

      expect(result).toStrictEqual({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/audit.yaml', 'name: Dependency audit\n', {
        dryRun: false,
        overwrite: false,
      });
    });
  });

  describe(scaffoldFiles, () => {
    it('returns config and workflow results in order', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('name: Dependency audit\n');
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.config/audit-deps.config.json', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });

      const results = scaffoldFiles({ dryRun: false, force: false });

      expect(results).toHaveLength(2);
      expect(results[0]).toStrictEqual({ filePath: '.config/audit-deps.config.json', outcome: 'created' });
      expect(results[1]).toStrictEqual({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });
      expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(2);
    });

    it('translates force to overwrite when calling the workflow helpers', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('name: Dependency audit\n');
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.config/audit-deps.config.json', outcome: 'overwritten' })
        .mockReturnValueOnce({ filePath: '.github/workflows/audit.yaml', outcome: 'overwritten' });

      scaffoldFiles({ dryRun: false, force: true });

      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.config/audit-deps.config.json', expect.any(String), {
        dryRun: false,
        overwrite: true,
      });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/audit.yaml', 'name: Dependency audit\n', {
        dryRun: false,
        overwrite: true,
      });
    });

    it('passes dryRun through to both helpers', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('name: Dependency audit\n');
      mockWriteFileWithCheck
        .mockReturnValueOnce({ filePath: '.config/audit-deps.config.json', outcome: 'created' })
        .mockReturnValueOnce({ filePath: '.github/workflows/audit.yaml', outcome: 'created' });

      scaffoldFiles({ dryRun: true, force: false });

      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.config/audit-deps.config.json', expect.any(String), {
        dryRun: true,
        overwrite: false,
      });
      expect(mockWriteFileWithCheck).toHaveBeenCalledWith('.github/workflows/audit.yaml', expect.any(String), {
        dryRun: true,
        overwrite: false,
      });
    });

    it('returns the failed workflow result when the template is missing', () => {
      mockExistsSync.mockReturnValue(false);
      mockWriteFileWithCheck.mockReturnValueOnce({ filePath: '.config/audit-deps.config.json', outcome: 'created' });

      const results = scaffoldFiles({ dryRun: false, force: false });

      expect(results).toHaveLength(2);
      expect(results[0]).toStrictEqual({ filePath: '.config/audit-deps.config.json', outcome: 'created' });
      expect(results[1]).toMatchObject({
        filePath: '.github/workflows/audit.yaml',
        outcome: 'failed',
      });
    });
  });
});
