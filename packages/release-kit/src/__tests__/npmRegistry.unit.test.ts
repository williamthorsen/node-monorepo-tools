import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookUpNpmPackage } from '../npmRegistry.ts';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

describe(lookUpNpmPackage, () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('reports a package that npm can view as published', () => {
    mockExecFileSync.mockReturnValue('"1.2.3"\n');

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({ status: 'published' });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npm',
      ['view', '@scope/pkg', 'version', '--json'],
      expect.objectContaining({ stdio: 'pipe' }),
    );
  });

  it('queries the given registry', () => {
    mockExecFileSync.mockReturnValue('"1.2.3"\n');

    lookUpNpmPackage('@scope/pkg', 'https://npm.example.com/');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npm',
      ['view', '@scope/pkg', 'version', '--json', '--registry', 'https://npm.example.com/'],
      expect.anything(),
    );
  });

  it('reports an E404 as unpublished', () => {
    mockExecFileSync.mockImplementation(() => {
      throw failWith(errorPayload('E404', 'Not Found - GET https://registry.npmjs.org/@scope%2fpkg'));
    });

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({ status: 'unpublished' });
  });

  it('reports an unreachable registry as unverifiable', () => {
    mockExecFileSync.mockImplementation(() => {
      throw failWith(errorPayload('ENOTFOUND', 'getaddrinfo ENOTFOUND registry.npmjs.org'));
    });

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({
      status: 'unverifiable',
      detail: 'Cannot reach the npm registry (ENOTFOUND)',
    });
  });

  it('reports a rejected session as unverifiable', () => {
    mockExecFileSync.mockImplementation(() => {
      throw failWith(errorPayload('E401', '401 Unauthorized'));
    });

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry rejected the session (E401)',
    });
  });

  it('reports any other npm error as unverifiable, with its code and summary', () => {
    mockExecFileSync.mockImplementation(() => {
      throw failWith(errorPayload('E500', 'Internal Server Error'));
    });

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry query failed (E500): Internal Server Error',
    });
  });

  it('reports a failure without a readable payload as unverifiable', () => {
    mockExecFileSync.mockImplementation(() => {
      throw failWith('');
    });

    expect(lookUpNpmPackage('@scope/pkg')).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry query failed without a readable error payload',
    });
  });
});

// region | Helpers
/** Builds npm's `--json` error envelope. */
function errorPayload(code: string, summary: string): string {
  return JSON.stringify({ error: { code, summary, detail: '' } });
}

/** Builds the error that `execFileSync` throws when npm exits non-zero, with npm's stdout attached. */
function failWith(stdout: string): Error {
  return Object.assign(new Error('Command failed: npm view'), { stdout });
}
// endregion | Helpers
