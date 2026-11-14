import { PassThrough } from 'node:stream';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it, vi } from 'vitest';

import {
  checkNodePin,
  type CheckNodePinOptions,
  NODE_BUILD_DEFINITION_URL,
  selectNodeUpgradeCandidates,
} from '../node-pin.ts';

const NOW = new Date('2026-10-29T12:00:00Z');

const RELEASES = [
  { version: 'v26.1.0', date: '2026-10-01', lts: false },
  { version: 'v24.23.0', date: '2026-10-28', lts: 'Krypton' },
  { version: 'v24.22.3', date: '2026-10-20', lts: 'Krypton' },
  { version: 'v24.22.2', date: '2026-10-10', lts: 'Krypton' },
  { version: 'v24.22.1', date: '2026-10-01', lts: 'Krypton' },
  { version: 'v22.30.0', date: '2026-10-15', lts: 'Jod' },
];

describe(selectNodeUpgradeCandidates, () => {
  it('returns every release in the pin major line that is newer and at least 24 hours old, newest first', () => {
    expect(selectNodeUpgradeCandidates('24.22.1', RELEASES, NOW)).toStrictEqual(['24.22.3', '24.22.2']);
  });

  it('never proposes a release in a newer major line', () => {
    expect(selectNodeUpgradeCandidates('24.22.1', [{ version: 'v26.1.0', date: '2026-10-01' }], NOW)).toStrictEqual([]);
  });

  it('returns nothing when the pin is current or ahead of every release in its line', () => {
    expect(selectNodeUpgradeCandidates('24.22.3', RELEASES, NOW)).toStrictEqual([]);
    expect(selectNodeUpgradeCandidates('24.99.0', RELEASES, NOW)).toStrictEqual([]);
  });

  // The index dates a release by UTC day alone, so a release dated D is certainly 24 hours old from D+2 00:00 UTC.
  it('proposes a release from the start of the second UTC day after its date, and not a moment before', () => {
    const releases = [{ version: 'v24.23.0', date: '2026-10-28' }];

    expect(selectNodeUpgradeCandidates('24.22.1', releases, new Date('2026-10-30T00:00:00Z'))).toStrictEqual([
      '24.23.0',
    ]);
    expect(selectNodeUpgradeCandidates('24.22.1', releases, new Date('2026-10-29T23:59:59.999Z'))).toStrictEqual([]);
  });

  it('ignores entries without a plain version or a YYYY-MM-DD date', () => {
    const releases = [
      { version: 'v24.30.0-rc.1', date: '2026-10-01' },
      { version: 'v24.29.0', date: 'yesterday' },
      { version: 24, date: '2026-10-01' },
      'v24.28.0',
      { version: 'v24.22.2', date: '2026-10-10' },
    ];

    expect(selectNodeUpgradeCandidates('24.22.1', releases, NOW)).toStrictEqual(['24.22.2']);
  });
});

describe(checkNodePin, () => {
  it('reports an available release without changing the file', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir);

    expect(output).toContain('nodejs 24.22.1 → 24.22.3 is available');
    expect(tree.read('.tool-versions')).toBe('nodejs 24.22.1\n');
  });

  it('rewrites only the pin under --write, leaving other entries, comments, and line endings unchanged', async () => {
    const original = '# runtimes\r\npython 3.13.1\r\nnodejs 24.22.1 22.30.0 # active first\r\npnpm 11.0.0\r\n';
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': original }));

    const output = await runCheck(tree.dir, { shouldWrite: true });

    expect(output).toContain('Updated nodejs 24.22.1 → 24.22.3');
    expect(tree.read('.tool-versions')).toBe(original.replace('24.22.1', '24.22.3'));
  });

  it('reports nothing when the pin is current', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.3\n' }));

    await expect(runCheck(tree.dir)).resolves.toBe('');
  });

  it.each([
    ['the file is absent', {}],
    ['the file has no nodejs entry', { '.tool-versions': 'python 3.13.1\n' }],
  ])('skips without output or a fetch when %s', async (_case, entries: Record<string, string>) => {
    const tree = disposeOnTestFinished(createTempTree(entries));
    let fetchCount = 0;

    const output = await runCheck(tree.dir, {
      fetchReleases: () => {
        fetchCount++;
        return Promise.resolve(RELEASES);
      },
    });

    expect(output).toBe('');
    expect(fetchCount).toBe(0);
  });

  it.each(['lts', 'v24.22.1', '24.22'])('notes and skips the non-plain pin %s', async (pin) => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': `nodejs ${pin}\n` }));

    const output = await runCheck(tree.dir);

    expect(output).toContain(`Skipped the nodejs pin '${pin}'`);
  });

  it('warns rather than throwing when the release index is unreachable', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir, {
      fetchReleases: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    });

    expect(output).toContain('WARN: Could not check the nodejs pin');
    expect(output).toContain('ENOTFOUND');
  });

  it('warns when the release index is not a list', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir, { fetchReleases: () => Promise.resolve({ error: 'oops' }) });

    expect(output).toContain('did not return a list of releases');
  });

  it('proposes the newest defined release and reports a newer undefined one as held back', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir, { isNodeBuildDefined: definedOnly('24.22.2') });

    expect(output).toContain('nodejs 24.22.1 → 24.22.2 is available');
    expect(output).toContain('nodejs 24.22.3 is held back: node-build does not define it yet.');
  });

  it('writes the newest defined release under --write, never an undefined one', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir, { isNodeBuildDefined: definedOnly('24.22.2'), shouldWrite: true });

    expect(output).toContain('Updated nodejs 24.22.1 → 24.22.2');
    expect(output).toContain('nodejs 24.22.3 is held back');
    expect(tree.read('.tool-versions')).toBe('nodejs 24.22.2\n');
  });

  it('reports only the held-back release and leaves the file unchanged when no newer release is defined', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.2\n' }));

    const output = await runCheck(tree.dir, { isNodeBuildDefined: definedOnly(), shouldWrite: true });

    expect(output).not.toContain('Updated');
    expect(output).toContain('nodejs 24.22.3 is held back');
    expect(tree.read('.tool-versions')).toBe('nodejs 24.22.2\n');
  });

  it('warns and does not write when the node-build definitions cannot be read', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    const output = await runCheck(tree.dir, {
      isNodeBuildDefined: () => Promise.reject(new Error('HTTP 503')),
      isSilent: true,
      shouldWrite: true,
    });

    expect(output).toContain('WARN: Could not check the nodejs pin');
    expect(output).toContain('node-build');
    expect(output).toContain('HTTP 503');
    expect(output).not.toContain('Updated');
    expect(tree.read('.tool-versions')).toBe('nodejs 24.22.1\n');
  });

  describe('default node-build probe', () => {
    it('sends a HEAD request for the definition file and treats 200 as defined', async () => {
      const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.2\n' }));
      using fetchSpy = stubFetchStatus(200);

      const output = await runCheckWithDefaultProbe(tree.dir);

      expect(output).toContain('nodejs 24.22.2 → 24.22.3 is available');
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        `${NODE_BUILD_DEFINITION_URL}24.22.3`,
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('treats 404 as undefined and holds the release back', async () => {
      const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.2\n' }));
      using _fetchSpy = stubFetchStatus(404);

      const output = await runCheckWithDefaultProbe(tree.dir, { shouldWrite: true });

      expect(output).toContain('nodejs 24.22.3 is held back');
      expect(tree.read('.tool-versions')).toBe('nodejs 24.22.2\n');
    });

    it('warns and does not write on any other status', async () => {
      const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.2\n' }));
      using _fetchSpy = stubFetchStatus(503);

      const output = await runCheckWithDefaultProbe(tree.dir, { shouldWrite: true });

      expect(output).toContain('WARN: Could not check the nodejs pin');
      expect(output).toContain('HTTP 503');
      expect(tree.read('.tool-versions')).toBe('nodejs 24.22.2\n');
    });
  });

  it('suppresses the report but not a warning when silent', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    await expect(runCheck(tree.dir, { isSilent: true })).resolves.toBe('');
    await expect(
      runCheck(tree.dir, { isSilent: true, fetchReleases: () => Promise.reject(new Error('offline')) }),
    ).resolves.toContain('WARN:');
  });
});

// region | Helpers

/** Runs the check with the fixture releases, a fixed clock, and `overrides`, returning what it wrote to stderr. */
async function captureCheck(dir: string, overrides: Partial<CheckNodePinOptions>): Promise<string> {
  const stderr = new PassThrough();
  const chunks: string[] = [];
  stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString());
  });

  await checkNodePin(dir, {
    fetchReleases: () => Promise.resolve(RELEASES),
    isSilent: false,
    now: NOW,
    shouldWrite: false,
    stderr,
    style: 'plain',
    ...overrides,
  });

  return chunks.join('');
}

/** Returns a node-build probe that defines only `versions`. */
function definedOnly(...versions: string[]): (version: string) => Promise<boolean> {
  return (version) => Promise.resolve(versions.includes(version));
}

/** Runs the check against `dir` with the fixture releases and a fixed clock, returning what it wrote to stderr. */
async function runCheck(dir: string, overrides: Partial<CheckNodePinOptions> = {}): Promise<string> {
  return captureCheck(dir, { isNodeBuildDefined: () => Promise.resolve(true), ...overrides });
}

/** Runs the check as `runCheck` does, but through the production node-build probe. */
async function runCheckWithDefaultProbe(
  dir: string,
  overrides: Partial<Omit<CheckNodePinOptions, 'isNodeBuildDefined'>> = {},
): Promise<string> {
  return captureCheck(dir, overrides);
}

/** Replaces `fetch` with one that answers every request with `status`, until the returned spy is disposed. */
function stubFetchStatus(status: number) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
}

// endregion | Helpers
