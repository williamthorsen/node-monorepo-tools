import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { hasPrettierConfig } from '../hasPrettierConfig.ts';

describe(hasPrettierConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns true when .prettierrc exists', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('.prettierrc'));

    expect(hasPrettierConfig()).toBe(true);
  });

  it('returns true when prettier.config.mjs exists', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('prettier.config.mjs'));

    expect(hasPrettierConfig()).toBe(true);
  });

  it('returns true when package.json has a "prettier" key', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-app', prettier: { singleQuote: true } }));

    expect(hasPrettierConfig()).toBe(true);
  });

  it('returns false when no prettier config exists', () => {
    mockExistsSync.mockReturnValue(false);

    expect(hasPrettierConfig()).toBe(false);
  });

  it('returns false when package.json exists but has no "prettier" key', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('package.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-app' }));

    expect(hasPrettierConfig()).toBe(false);
  });

  it('returns false when package.json is malformed', () => {
    mockExistsSync.mockImplementation((filePath: string) => filePath.endsWith('package.json'));
    mockReadFileSync.mockReturnValue('not json');

    expect(hasPrettierConfig()).toBe(false);
  });
});
