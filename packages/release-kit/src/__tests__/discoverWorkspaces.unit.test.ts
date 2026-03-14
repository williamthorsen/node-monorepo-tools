import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockGlob = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('glob', () => ({
  glob: mockGlob,
}));

import { discoverWorkspaces } from '../discoverWorkspaces.ts';

describe(discoverWorkspaces, () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockGlob.mockReset();
    vi.restoreAllMocks();
  });

  it('returns undefined when pnpm-workspace.yaml does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await discoverWorkspaces();

    expect(result).toBeUndefined();
  });

  it('returns undefined when pnpm-workspace.yaml has no packages field', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('nodeLinker: hoisted\n');

    const result = await discoverWorkspaces();

    expect(result).toBeUndefined();
  });

  it('returns workspace paths for a valid pnpm-workspace.yaml', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === 'pnpm-workspace.yaml') return true;
      // package.json checks for discovered directories
      if (path === 'packages/arrays/package.json') return true;
      if (path === 'packages/strings/package.json') return true;
      return false;
    });
    mockReadFileSync.mockReturnValue('packages:\n  - packages/*\n');
    mockGlob.mockResolvedValue(['packages/arrays', 'packages/strings']);

    const result = await discoverWorkspaces();

    expect(result).toStrictEqual(['packages/arrays', 'packages/strings']);
  });

  it('returns paths for multiple glob patterns', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === 'pnpm-workspace.yaml') return true;
      if (path === 'packages/arrays/package.json') return true;
      if (path === 'libs/core/package.json') return true;
      return false;
    });
    mockReadFileSync.mockReturnValue('packages:\n  - packages/*\n  - libs/*\n');
    mockGlob.mockResolvedValueOnce(['packages/arrays']).mockResolvedValueOnce(['libs/core']);

    const result = await discoverWorkspaces();

    expect(result).toStrictEqual(['libs/core', 'packages/arrays']);
  });

  it('skips directories that do not contain a package.json', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === 'pnpm-workspace.yaml') return true;
      if (path === 'packages/arrays/package.json') return true;
      // packages/docs has no package.json
      if (path === 'packages/docs/package.json') return false;
      return false;
    });
    mockReadFileSync.mockReturnValue('packages:\n  - packages/*\n');
    mockGlob.mockResolvedValue(['packages/arrays', 'packages/docs']);

    const result = await discoverWorkspaces();

    expect(result).toStrictEqual(['packages/arrays']);
  });

  it('returns undefined when no directories match the globs', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      return path === 'pnpm-workspace.yaml';
    });
    mockReadFileSync.mockReturnValue('packages:\n  - packages/*\n');
    mockGlob.mockResolvedValue([]);

    const result = await discoverWorkspaces();

    expect(result).toBeUndefined();
  });

  it('returns undefined and logs a warning when readFileSync throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = await discoverWorkspaces();

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  it('returns undefined when packages array is empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('packages: []\n');

    const result = await discoverWorkspaces();

    expect(result).toBeUndefined();
  });
});
