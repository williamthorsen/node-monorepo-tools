import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { hasCliffToml, hasPackageJson, isGitRepo, notAlreadyInitialized, usesPnpm } from '../checks.ts';

describe('checks', () => {
  afterEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  describe(isGitRepo, () => {
    it('returns ok when inside a git repo', () => {
      mockExecSync.mockReturnValue(Buffer.from('true'));

      expect(isGitRepo()).toStrictEqual({ ok: true });
    });

    it('returns not ok when not inside a git repo', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      const result = isGitRepo();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('git');
    });
  });

  describe(hasPackageJson, () => {
    it('returns ok when package.json exists', () => {
      mockExistsSync.mockReturnValue(true);

      expect(hasPackageJson()).toStrictEqual({ ok: true });
    });

    it('returns not ok when package.json is missing', () => {
      mockExistsSync.mockReturnValue(false);

      const result = hasPackageJson();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('package.json');
    });
  });

  describe(usesPnpm, () => {
    it('returns ok when pnpm-lock.yaml exists', () => {
      mockExistsSync.mockReturnValue(true);

      expect(usesPnpm()).toStrictEqual({ ok: true });
    });

    it('returns ok when packageManager field contains pnpm', () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

      expect(usesPnpm()).toStrictEqual({ ok: true });
    });

    it('returns not ok when neither pnpm-lock.yaml nor packageManager exists', () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));

      const result = usesPnpm();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('pnpm');
    });

    it('returns not ok when packageManager is not pnpm', () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'npm@10.0.0' }));

      const result = usesPnpm();
      expect(result.ok).toBe(false);
    });

    it('throws when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => usesPnpm()).toThrow('EACCES: permission denied');
      expect(mockReadFileSync).toHaveBeenCalledWith('package.json', 'utf8');
    });
  });

  describe(hasCliffToml, () => {
    it('returns ok when cliff.toml exists', () => {
      mockExistsSync.mockReturnValue(true);

      expect(hasCliffToml()).toStrictEqual({ ok: true });
    });

    it('returns not ok when cliff.toml is missing', () => {
      mockExistsSync.mockReturnValue(false);

      const result = hasCliffToml();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('cliff.toml');
    });
  });

  describe(notAlreadyInitialized, () => {
    it('returns ok when release.config.ts does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(notAlreadyInitialized()).toStrictEqual({ ok: true });
    });

    it('returns not ok when release.config.ts exists', () => {
      mockExistsSync.mockReturnValue(true);

      const result = notAlreadyInitialized();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('already initialized');
    });
  });
});
