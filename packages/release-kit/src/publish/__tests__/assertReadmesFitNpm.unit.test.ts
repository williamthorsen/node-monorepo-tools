import { UserError } from '@williamthorsen/nmr-core';
import { captureError } from '@williamthorsen/toolbelt.testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertReadmesFitNpm,
  buildNpmReadme,
  countCodePoints,
  NPM_README_MAX_CODE_POINTS,
} from '../assertReadmesFitNpm.ts';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

const FILES: Record<string, string> = {
  'packages/internal/package.json': JSON.stringify({ name: '@scope/internal', private: true }),
  'packages/large/package.json': JSON.stringify({ name: '@scope/large' }),
  'packages/small/package.json': JSON.stringify({ name: '@scope/small' }),
  'packages/small/README.md': '# Small\n',
};

describe(assertReadmesFitNpm, () => {
  beforeEach(() => {
    mockReadFileSync.mockImplementation(readFixture);
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('passes a README of exactly the cap', () => {
    expect(() =>
      assertReadmesFitNpm([makeReadme('packages/large', 'a'.repeat(NPM_README_MAX_CODE_POINTS))]),
    ).not.toThrow();
  });

  it('passes a README whose UTF-16 length exceeds the cap but whose code-point count does not', () => {
    const content = '😀'.repeat(NPM_README_MAX_CODE_POINTS);

    expect(content.length).toBeGreaterThan(NPM_README_MAX_CODE_POINTS);
    expect(() => assertReadmesFitNpm([makeReadme('packages/large', content)])).not.toThrow();
  });

  it('refuses a README one code point over the cap, naming the package, the README, and the excess', async () => {
    const error = await captureError(UserError, () =>
      assertReadmesFitNpm([makeReadme('packages/large', 'a'.repeat(NPM_README_MAX_CODE_POINTS + 1))]),
    );

    expect(error.message).toContain('npm truncates a README longer than 65,536 code points');
    expect(error.message).toContain('@scope/large (packages/large/README.md): 65,537 code points, 1 over the cap');
  });

  it('lists every oversized package in one refusal', async () => {
    const oversized = 'a'.repeat(NPM_README_MAX_CODE_POINTS + 10);

    const error = await captureError(UserError, () =>
      assertReadmesFitNpm([makeReadme('packages/large', oversized), makeReadme('packages/small', oversized)]),
    );

    expect(error.message).toContain('@scope/large (packages/large/README.md)');
    expect(error.message).toContain('@scope/small (packages/small/README.md)');
  });

  it('does not check a private package', () => {
    const oversized = 'a'.repeat(NPM_README_MAX_CODE_POINTS + 1);

    expect(() => assertReadmesFitNpm([makeReadme('packages/internal', oversized)])).not.toThrow();
  });
});

describe(buildNpmReadme, () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((filePath: string) => filePath in FILES);
    mockReadFileSync.mockImplementation(readFixture);
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns the README read from the workspace', () => {
    expect(buildNpmReadme('packages/small', undefined, 'small-v1.0.0')).toStrictEqual({
      workspacePath: 'packages/small',
      readmePath: 'packages/small/README.md',
      content: '# Small\n',
    });
  });

  it('returns undefined when the workspace does not have a README', () => {
    expect(buildNpmReadme('packages/large', undefined, 'large-v1.0.0')).toBeUndefined();
  });
});

describe(countCodePoints, () => {
  it('counts an astral character once', () => {
    expect(countCodePoints('a😀b')).toBe(3);
  });
});

// region | Helpers

/** Builds an `NpmReadme` at the workspace's `README.md`. */
function makeReadme(workspacePath: string, content: string) {
  return { workspacePath, readmePath: `${workspacePath}/README.md`, content };
}

/** Returns a fixture file's content, throwing for a path that the fixtures don't contain. */
function readFixture(filePath: string): string {
  const content = FILES[filePath];
  if (content === undefined) {
    throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
  }
  return content;
}

// endregion | Helpers
