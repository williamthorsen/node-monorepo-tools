import { PassThrough } from 'node:stream';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { checkNodePin, type CheckNodePinOptions, selectNodeUpgrade } from '../node-pin.ts';

const NOW = new Date('2026-10-29T12:00:00Z');

const RELEASES = [
  { version: 'v26.1.0', date: '2026-10-01', lts: false },
  { version: 'v24.23.0', date: '2026-10-28', lts: 'Krypton' },
  { version: 'v24.22.3', date: '2026-10-20', lts: 'Krypton' },
  { version: 'v24.22.2', date: '2026-10-10', lts: 'Krypton' },
  { version: 'v24.22.1', date: '2026-10-01', lts: 'Krypton' },
  { version: 'v22.30.0', date: '2026-10-15', lts: 'Jod' },
];

describe(selectNodeUpgrade, () => {
  it('returns the newest release in the pin major line that is at least 24 hours old', () => {
    expect(selectNodeUpgrade('24.22.1', RELEASES, NOW)).toBe('24.22.3');
  });

  it('never proposes a release in a newer major line', () => {
    expect(selectNodeUpgrade('24.22.1', [{ version: 'v26.1.0', date: '2026-10-01' }], NOW)).toBeUndefined();
  });

  it('returns undefined when the pin is current or ahead of every release in its line', () => {
    expect(selectNodeUpgrade('24.22.3', RELEASES, NOW)).toBeUndefined();
    expect(selectNodeUpgrade('24.99.0', RELEASES, NOW)).toBeUndefined();
  });

  // The index dates a release by UTC day alone, so a release dated D is certainly 24 hours old from D+2 00:00 UTC.
  it('proposes a release from the start of the second UTC day after its date, and not a moment before', () => {
    const releases = [{ version: 'v24.23.0', date: '2026-10-28' }];

    expect(selectNodeUpgrade('24.22.1', releases, new Date('2026-10-30T00:00:00Z'))).toBe('24.23.0');
    expect(selectNodeUpgrade('24.22.1', releases, new Date('2026-10-29T23:59:59.999Z'))).toBeUndefined();
  });

  it('ignores entries without a plain version or a YYYY-MM-DD date', () => {
    const releases = [
      { version: 'v24.30.0-rc.1', date: '2026-10-01' },
      { version: 'v24.29.0', date: 'yesterday' },
      { version: 24, date: '2026-10-01' },
      'v24.28.0',
      { version: 'v24.22.2', date: '2026-10-10' },
    ];

    expect(selectNodeUpgrade('24.22.1', releases, NOW)).toBe('24.22.2');
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

  it('suppresses the report but not a warning when silent', async () => {
    const tree = disposeOnTestFinished(createTempTree({ '.tool-versions': 'nodejs 24.22.1\n' }));

    await expect(runCheck(tree.dir, { isSilent: true })).resolves.toBe('');
    await expect(
      runCheck(tree.dir, { isSilent: true, fetchReleases: () => Promise.reject(new Error('offline')) }),
    ).resolves.toContain('WARN:');
  });
});

// region | Helpers

/** Runs the check against `dir` with the fixture releases and a fixed clock, returning what it wrote to stderr. */
async function runCheck(dir: string, overrides: Partial<CheckNodePinOptions> = {}): Promise<string> {
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

// endregion | Helpers
