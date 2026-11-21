import { UserError } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NpmViewResult } from '../../clients/npm/npm-registry.ts';
import { type FakeNpm, makeFakeNpm } from '../../test-utils/makeFakeNpm.ts';
import {
  REGISTRY_POLL_INTERVAL_MS,
  REGISTRY_WAIT_TIMEOUT_MS,
  type RegistryWaitDependencies,
  waitForRegistryVersions,
} from '../waitForRegistryVersions.ts';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

const NOT_FOUND: NpmViewResult = { ok: false, error: { code: 'E404', summary: 'No match found for version' } };
const UNREACHABLE: NpmViewResult = { ok: false, error: { code: 'ETIMEDOUT', summary: 'timed out' } };

const MANIFESTS: Record<string, unknown> = {
  'packages/arrays/package.json': { name: '@scope/arrays', version: '1.2.0' },
  'packages/internal/package.json': { name: '@scope/internal', version: '0.1.0', private: true },
  'packages/mirrored/package.json': {
    name: '@scope/mirrored',
    version: '2.0.0',
    publishConfig: { registry: 'https://npm.example.com/' },
  },
  'packages/unversioned/package.json': { name: '@scope/unversioned' },
};

describe(waitForRegistryVersions, () => {
  let clock: number;
  let npm: FakeNpm;
  let stdioCapture: CapturedStdio;
  let dependencies: RegistryWaitDependencies;

  beforeEach(() => {
    stdioCapture = captureStdio();
    mockReadFileSync.mockImplementation((filePath: string) => {
      const manifest = MANIFESTS[filePath];
      if (manifest === undefined) {
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      }
      return JSON.stringify(manifest);
    });
    clock = 0;
    npm = makeFakeNpm();
    dependencies = {
      now: () => clock,
      npm,
      sleep: vi.fn((milliseconds: number) => {
        clock += milliseconds;
        return Promise.resolve();
      }),
    };
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockReadFileSync.mockReset();
  });

  it('returns without waiting when the registry already lists every version', async () => {
    await waitForRegistryVersions(['packages/arrays', 'packages/mirrored'], dependencies);

    expect(npm.viewPackageVersion).toHaveBeenCalledWith('@scope/arrays', '1.2.0', undefined);
    expect(npm.viewPackageVersion).toHaveBeenCalledWith('@scope/mirrored', '2.0.0', 'https://npm.example.com/');
    expect(dependencies.sleep).not.toHaveBeenCalled();
    expect(stdioCapture.stderr).toBe('');
  });

  it('polls a missing version until it appears, querying only the versions still missing', async () => {
    npm.viewPackageVersion.mockImplementation((name) => (name === '@scope/arrays' ? { ok: true } : NOT_FOUND));
    npm.viewPackageVersion.mockImplementationOnce(() => ({ ok: true }));
    npm.viewPackageVersion.mockImplementationOnce(() => NOT_FOUND);
    npm.viewPackageVersion.mockImplementationOnce(() => UNREACHABLE);
    npm.viewPackageVersion.mockImplementationOnce(() => ({ ok: true }));

    await waitForRegistryVersions(['packages/arrays', 'packages/mirrored'], dependencies);

    expect(npm.viewPackageVersion).toHaveBeenCalledTimes(4);
    expect(npm.viewPackageVersion.mock.calls.slice(2).map(([name]) => name)).toStrictEqual([
      '@scope/mirrored',
      '@scope/mirrored',
    ]);
    expect(dependencies.sleep).toHaveBeenCalledTimes(2);
    expect(dependencies.sleep).toHaveBeenCalledWith(REGISTRY_POLL_INTERVAL_MS);
    expect(stdioCapture.stderr).toContain('Waiting for 1 of 2 published versions to appear on the registry');
  });

  it('fails after the timeout, naming each missing version and the detail of an unconfirmed one', async () => {
    npm.viewPackageVersion.mockImplementation((name) => (name === '@scope/arrays' ? NOT_FOUND : UNREACHABLE));

    const error = await captureError(UserError, () =>
      waitForRegistryVersions(['packages/arrays', 'packages/mirrored'], dependencies),
    );

    expect(error.message).toBe(
      [
        'The publish succeeded, but these versions did not appear on the registry within 5 minutes:',
        '  - @scope/arrays@1.2.0',
        '  - @scope/mirrored@2.0.0: Cannot reach the npm registry (ETIMEDOUT)',
      ].join('\n'),
    );
    expect(clock).toBeGreaterThanOrEqual(REGISTRY_WAIT_TIMEOUT_MS);
  });

  it('does not query a private package or an empty list', async () => {
    await waitForRegistryVersions(['packages/internal'], dependencies);
    await waitForRegistryVersions([], dependencies);

    expect(npm.viewPackageVersion).not.toHaveBeenCalled();
  });

  it('refuses a publishable manifest that does not set a version', async () => {
    const error = await captureError(UserError, () => waitForRegistryVersions(['packages/unversioned'], dependencies));

    expect(error.message).toBe(
      'Cannot wait for @scope/unversioned on the registry: packages/unversioned/package.json does not set a version.',
    );
  });
});
