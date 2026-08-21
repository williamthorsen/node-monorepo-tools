import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, assert, describe, expect, it as baseIt, vi } from 'vitest';

import type { ChangelogEntry } from '../types.ts';

vi.mock(import('node:child_process'), () => ({
  execFileSync: vi.fn(),
}));

vi.mock(import('../renderReleaseNotes.ts'), async () => {
  const actual = await vi.importActual<typeof import('../renderReleaseNotes.ts')>('../renderReleaseNotes.ts');
  return {
    ...actual,
    renderReleaseNotesSingle: vi.fn(actual.renderReleaseNotesSingle),
  };
});

const { execFileSync } = await import('node:child_process');
const { renderReleaseNotesSingle } = await import('../renderReleaseNotes.ts');
const { createGithubRelease } = await import('../createGithubRelease.ts');

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedRenderReleaseNotesSingle = vi.mocked(renderReleaseNotesSingle);

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'test-gh-release-' })),
);

describe(createGithubRelease, () => {
  const sampleEntries: ChangelogEntry[] = [
    {
      version: '1.0.0',
      date: '2024-11-15',
      sections: [
        { title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] },
        { title: 'CI', audience: 'dev', items: [{ description: 'Update pipeline' }] },
      ],
    },
  ];

  afterEach(() => {
    mockedRenderReleaseNotesSingle.mockClear();
  });

  it('returns no-entry skip and warns when changelog.json does not exist', ({ tree }) => {
    using silent = silenceConsole(['warn']);
    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath: join(tree.dir, 'nonexistent.json'),
      dryRun: false,
    });
    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-entry' });
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('returns no-entry skip and warns when changelog.json cannot be parsed', ({ tree }) => {
    const changelogJsonPath = tree.write('changelog.json', 'not valid json{{{');
    using silent = silenceConsole(['warn']);

    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });
    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-entry' });
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('could not parse'));
  });

  it('returns no-entry skip and warns when version is not in changelog.json', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    using silent = silenceConsole(['warn']);

    const result = createGithubRelease({
      tag: 'v99.0.0',
      changelogJsonPath,
      dryRun: false,
    });
    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-entry' });
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('no changelog entry'));
  });

  it('logs the command in dry-run mode without executing', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    using silent = silenceConsole(['info']);

    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: true,
    });
    expect(result).toStrictEqual({ status: 'created' });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
  });

  it('calls gh CLI with correct arguments', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['release', 'create', 'v1.0.0']),
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('passes only all-audience sections in the release notes', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    const callArgs = mockedExecFileSync.mock.calls[0];
    const args = callArgs?.[1];
    assert(Array.isArray(args));
    const notesIndex = args.indexOf('--notes');
    const body = args[notesIndex + 1];
    expect(body).toContain('Features');
    expect(body).not.toContain('CI');
  });

  it('propagates the error when gh CLI invocation fails', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('gh failed');
    });

    expect(() =>
      createGithubRelease({
        tag: 'v1.0.0',
        changelogJsonPath,
        dryRun: false,
      }),
    ).toThrow('gh failed');
  });

  it('skips release with reason no-audience-content when entry has only dev-audience sections', ({ tree }) => {
    mockedExecFileSync.mockClear();
    using silent = silenceConsole(['warn']);
    const devOnlyEntries: ChangelogEntry[] = [
      {
        version: '2.0.0',
        date: '2024-12-01',
        sections: [
          { title: 'CI', audience: 'dev', items: [{ description: 'Update pipeline' }] },
          { title: 'Tooling', audience: 'dev', items: [{ description: 'Enable npm publish' }] },
        ],
      },
    ];
    const changelogJsonPath = tree.writeJson('changelog.json', devOnlyEntries);

    const result = createGithubRelease({
      tag: 'v2.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-audience-content' });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    // Intentional skips must stay silent at the lib layer; the per-tag info summary is the
    // command's responsibility and does not run through console.warn.
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('skips release with reason empty-body when rendered all-audience body is empty', ({ tree }) => {
    mockedExecFileSync.mockClear();
    using silent = silenceConsole(['warn']);
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    mockedRenderReleaseNotesSingle.mockReturnValueOnce('   \n   ');

    const result = createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(result).toStrictEqual({ status: 'skipped', reason: 'empty-body' });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('extracts version from prefixed tags and matches correct entry', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease({
      tag: 'release-kit-v1.0.0',
      changelogJsonPath,
      dryRun: false,
    });

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['release', 'create', 'release-kit-v1.0.0']),
      expect.anything(),
    );
    const callArgs = mockedExecFileSync.mock.calls[0];
    const args = callArgs?.[1];
    assert(Array.isArray(args));
    const notesIndex = args.indexOf('--notes');
    const body = args[notesIndex + 1];
    expect(body).toContain('Add widget');
  });

  it('forwards sectionOrder to renderReleaseNotesSingle when provided', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: true,
      sectionOrder: ['Bug fixes', 'Features'],
    });

    expect(mockedRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease({
      tag: 'v1.0.0',
      changelogJsonPath,
      dryRun: true,
    });

    const renderOptions = mockedRenderReleaseNotesSingle.mock.calls[0]?.[1];
    expect(renderOptions).not.toHaveProperty('sectionOrder');
  });
});
