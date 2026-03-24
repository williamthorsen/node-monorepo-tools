import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

import { detectPackageManager } from '../detectPackageManager.ts';

describe(detectPackageManager, () => {
  beforeEach(() => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
    mockExistsSync.mockReset();
  });

  it('detects pnpm from the packageManager field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'pnpm@9.15.4' }));

    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects npm from the packageManager field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'npm@10.2.0' }));

    expect(detectPackageManager()).toBe('npm');
  });

  it('detects Yarn Classic from the packageManager field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.19' }));

    expect(detectPackageManager()).toBe('yarn');
  });

  it('detects Yarn Berry from the packageManager field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@4.1.0' }));

    expect(detectPackageManager()).toBe('yarn-berry');
  });

  it('detects Yarn Berry for v2', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@2.0.0' }));

    expect(detectPackageManager()).toBe('yarn-berry');
  });

  it('detects Yarn Berry for v3', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@3.6.4' }));

    expect(detectPackageManager()).toBe('yarn-berry');
  });

  it('treats yarn without version as Classic', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn' }));

    expect(detectPackageManager()).toBe('yarn');
  });

  it('handles packageManager field without version suffix', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'pnpm' }));

    expect(detectPackageManager()).toBe('pnpm');
  });

  it('falls back to lockfile detection when packageManager field is unrecognized', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'bun@1.0.0' }));
    mockExistsSync.mockReturnValue(false);

    expect(detectPackageManager()).toBe('npm');
  });

  it('falls back to lockfile detection when packageManager field is absent', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-package' }));
    mockExistsSync.mockImplementation((path: string) => path.endsWith('pnpm-lock.yaml'));

    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects npm from package-lock.json', () => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockImplementation((path: string) => path.endsWith('package-lock.json'));

    expect(detectPackageManager()).toBe('npm');
  });

  it('detects yarn from yarn.lock', () => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockImplementation((path: string) => path.endsWith('yarn.lock'));

    expect(detectPackageManager()).toBe('yarn');
  });

  it('defaults to npm when no signal is found', () => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockReturnValue(false);

    expect(detectPackageManager()).toBe('npm');
  });

  it('falls back to lockfile detection when package.json cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockExistsSync.mockImplementation((path: string) => path.endsWith('yarn.lock'));

    expect(detectPackageManager()).toBe('yarn');
  });

  it('falls back to lockfile detection when package.json contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    mockExistsSync.mockImplementation((path: string) => path.endsWith('pnpm-lock.yaml'));

    expect(detectPackageManager()).toBe('pnpm');
  });
});
