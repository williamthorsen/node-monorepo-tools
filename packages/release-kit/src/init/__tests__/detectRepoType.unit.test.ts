import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { detectRepoType } from '../detectRepoType.ts';

describe(detectRepoType, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns monorepo when pnpm-workspace.yaml exists', () => {
    mockExistsSync.mockReturnValue(true);

    expect(detectRepoType()).toBe('monorepo');
  });

  it('returns monorepo when package.json has a workspaces field', () => {
    mockExistsSync.mockImplementation((path: string) => path === 'package.json');
    mockReadFileSync.mockReturnValue(JSON.stringify({ workspaces: ['packages/*'] }));

    expect(detectRepoType()).toBe('monorepo');
  });

  it('returns single-package when neither indicator is present', () => {
    mockExistsSync.mockImplementation((path: string) => path === 'package.json');
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-app' }));

    expect(detectRepoType()).toBe('single-package');
  });

  it('returns single-package when package.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(detectRepoType()).toBe('single-package');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('throws when package.json exists but cannot be read', () => {
    mockExistsSync.mockImplementation((path: string) => path === 'package.json');
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => detectRepoType()).toThrow('EACCES: permission denied');
  });
});
