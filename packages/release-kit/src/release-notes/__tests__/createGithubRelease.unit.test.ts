import { join } from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { type FakeGh, makeFakeGh } from '../../test-utils/makeFakeGh.ts';
import type { ChangelogEntry } from '../../types.ts';

vi.mock(import('../render-release-notes.ts'), async () => {
  const actualModule = await vi.importActual<typeof import('../render-release-notes.ts')>('../render-release-notes.ts');
  return {
    ...actualModule,
    renderReleaseNotesSingle: vi.fn(actualModule.renderReleaseNotesSingle),
  };
});

const { renderReleaseNotesSingle } = await import('../render-release-notes.ts');
const { createGithubRelease, createGithubReleases } = await import('../createGithubRelease.ts');

const mockedRenderReleaseNotesSingle = vi.mocked(renderReleaseNotesSingle);

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

  let gh: FakeGh;

  beforeEach(() => {
    gh = makeFakeGh();
  });

  afterEach(() => {
    mockedRenderReleaseNotesSingle.mockClear();
  });

  it('returns a missing-file skip without warning when changelog.json does not exist', ({ tree }) => {
    using silencedConsole = silenceConsole(['warn']);
    const result = createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath: join(tree.dir, 'nonexistent.json'),
        isDryRun: false,
      },
      gh,
    );
    expect(result).toStrictEqual({ status: 'skipped', reason: 'missing-file' });
    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });

  it('returns an unreadable-file skip without warning when changelog.json cannot be parsed', ({ tree }) => {
    const changelogJsonPath = tree.write('changelog.json', 'not valid json{{{');
    using silencedConsole = silenceConsole(['warn']);

    const result = createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );
    expect(result).toStrictEqual({ status: 'skipped', reason: 'unreadable-file' });
    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });

  it('returns a no-entry skip without warning when version is not in changelog.json', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    using silencedConsole = silenceConsole(['warn']);

    const result = createGithubRelease(
      {
        tag: 'v99.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );
    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-entry' });
    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });

  it('logs the command in dry-run mode without executing', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    using silencedConsole = silenceConsole(['info']);

    const result = createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: true,
      },
      gh,
    );
    expect(result).toStrictEqual({ status: 'created' });
    expect(gh.createRelease).not.toHaveBeenCalled();
    expect(silencedConsole.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
  });

  it('calls gh CLI with correct arguments', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );

    expect(gh.createRelease).toHaveBeenCalledExactlyOnceWith('v1.0.0', expect.any(String));
  });

  it('passes only all-audience sections in the release notes', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );

    const body = gh.createRelease.mock.calls[0]?.[1];
    expect(body).toContain('Features');
    expect(body).not.toContain('CI');
  });

  it('propagates the error when gh CLI invocation fails', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    gh.createRelease.mockImplementationOnce(() => {
      throw new Error('gh failed');
    });

    expect(() =>
      createGithubRelease(
        {
          tag: 'v1.0.0',
          changelogJsonPath,
          isDryRun: false,
        },
        gh,
      ),
    ).toThrow('gh failed');
  });

  it('skips release with reason no-audience-content when entry has only dev-audience sections', ({ tree }) => {
    using silencedConsole = silenceConsole(['warn']);
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

    const result = createGithubRelease(
      {
        tag: 'v2.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );

    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-audience-content' });
    expect(gh.createRelease).not.toHaveBeenCalled();
    // Intentional skips must stay silent at the lib layer; the per-tag info summary is the
    // command's responsibility and does not run through console.warn.
    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });

  it('skips release with reason empty-body when rendered all-audience body is empty', ({ tree }) => {
    using silencedConsole = silenceConsole(['warn']);
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);
    mockedRenderReleaseNotesSingle.mockReturnValueOnce('   \n   ');

    const result = createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );

    expect(result).toStrictEqual({ status: 'skipped', reason: 'empty-body' });
    expect(gh.createRelease).not.toHaveBeenCalled();
    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });

  it('extracts version from prefixed tags and matches correct entry', ({ tree }) => {
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease(
      {
        tag: 'release-kit-v1.0.0',
        changelogJsonPath,
        isDryRun: false,
      },
      gh,
    );

    expect(gh.createRelease).toHaveBeenCalledExactlyOnceWith(
      'release-kit-v1.0.0',
      expect.stringContaining('Add widget'),
    );
  });

  it('forwards sectionOrder to renderReleaseNotesSingle when provided', ({ tree }) => {
    using _silencedConsole = silenceConsole(['info']);
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: true,
        sectionOrder: ['Bug fixes', 'Features'],
      },
      gh,
    );

    expect(mockedRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', ({ tree }) => {
    using _silencedConsole = silenceConsole(['info']);
    const changelogJsonPath = tree.writeJson('changelog.json', sampleEntries);

    createGithubRelease(
      {
        tag: 'v1.0.0',
        changelogJsonPath,
        isDryRun: true,
      },
      gh,
    );

    const renderOptions = mockedRenderReleaseNotesSingle.mock.calls[0]?.[1];
    expect(renderOptions).not.toHaveProperty('sectionOrder');
  });
});

describe(createGithubReleases, () => {
  it('records each skip with its reason and the changelog path read for it', ({ tree }) => {
    tree.write('packages/broken/.meta/changelog.json', '{bad json');

    const outcome = createGithubReleases(
      [
        { tag: 'missing-v1.0.0', workspacePath: join(tree.dir, 'packages/missing') },
        { tag: 'broken-v1.0.0', workspacePath: join(tree.dir, 'packages/broken') },
      ],
      '.meta/changelog.json',
      false,
      undefined,
      makeFakeGh(),
    );

    expect(outcome).toStrictEqual({
      createdTags: [],
      skippedTags: [
        {
          tag: 'missing-v1.0.0',
          reason: 'missing-file',
          changelogJsonPath: join(tree.dir, 'packages/missing/.meta/changelog.json'),
        },
        {
          tag: 'broken-v1.0.0',
          reason: 'unreadable-file',
          changelogJsonPath: join(tree.dir, 'packages/broken/.meta/changelog.json'),
        },
      ],
    });
  });
});
