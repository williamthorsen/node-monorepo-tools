import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());
const mockLoadChangelogEntries = vi.hoisted(() => vi.fn());
const mockMatchesAudience = vi.hoisted(() => vi.fn());
const mockRenderReleaseNotesSingle = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('../changelogJsonUtils.ts'), () => ({
  extractVersion: mockExtractVersion,
  loadChangelogEntries: mockLoadChangelogEntries,
}));

vi.mock(import('../renderReleaseNotes.ts'), () => ({
  matchesAudience: mockMatchesAudience,
  renderReleaseNotesSingle: mockRenderReleaseNotesSingle,
}));

import {
  injectReleaseNotesIntoReadme,
  renderInjectedReadme,
  renderInjectedReadmeFromEntries,
  resolveReadmePath,
} from '../injectReleaseNotesIntoReadme.ts';
import type { ChangelogEntry } from '../types.ts';

describe(injectReleaseNotesIntoReadme, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockExtractVersion.mockReset();
    mockLoadChangelogEntries.mockReset();
    mockMatchesAudience.mockReset();
    mockRenderReleaseNotesSingle.mockReset();
    vi.restoreAllMocks();
  });

  function stubInjectionMocks(): void {
    mockExistsSync.mockImplementation((filePath: string) => {
      return typeof filePath === 'string' && (filePath.endsWith('README.md') || filePath.endsWith('changelog.json'));
    });
    mockReadFileSync.mockReturnValue('# Original README\n');
    mockExtractVersion.mockReturnValue('1.0.0');
    mockLoadChangelogEntries.mockReturnValue({
      status: 'loaded',
      rejectedCount: 0,
      entries: [
        {
          version: '1.0.0',
          date: '2024-01-01',
          sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
        },
      ],
    });
    mockMatchesAudience.mockReturnValue(() => true);
    mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
  }

  it('injects release notes and returns original content', () => {
    stubInjectionMocks();

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toStrictEqual({ status: 'injected', originalReadme: '# Original README\n' });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const injectedContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(typeof injectedContent === 'string' && injectedContent).toContain('Features');
  });

  it('returns a missing-file skip when changelog.json is missing', () => {
    mockReadFileSync.mockReturnValue('# README\n');
    mockLoadChangelogEntries.mockReturnValue({ status: 'missing' });

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'missing-file' } });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns an unreadable-file skip when changelog.json is malformed', () => {
    mockReadFileSync.mockReturnValue('# README\n');
    mockLoadChangelogEntries.mockReturnValue({ status: 'unreadable', reason: 'Unexpected token' });

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'unreadable-file' } });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns a no-entry skip when the changelog does not contain an entry matching the tag version', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# README\n');
    mockExtractVersion.mockReturnValue('99.0.0');
    mockLoadChangelogEntries.mockReturnValue({
      status: 'loaded',
      rejectedCount: 0,
      entries: [{ version: '1.0.0', date: '2024-01-01', sections: [] }],
    });

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v99.0.0');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'no-entry', version: '99.0.0' } });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns an empty-body skip when all sections are dev-only', () => {
    stubInjectionMocks();
    mockRenderReleaseNotesSingle.mockReturnValue('');

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'empty-body', version: '1.0.0' } });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('forwards sectionOrder to renderReleaseNotesSingle when provided', () => {
    stubInjectionMocks();

    injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0', ['Bug fixes', 'Features']);

    expect(mockRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', () => {
    stubInjectionMocks();

    injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    const renderOptions = mockRenderReleaseNotesSingle.mock.calls[0]?.[1];
    expect(renderOptions).not.toHaveProperty('sectionOrder');
  });
});

describe(renderInjectedReadme, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockExtractVersion.mockReset();
    mockLoadChangelogEntries.mockReset();
    mockMatchesAudience.mockReset();
    mockRenderReleaseNotesSingle.mockReset();
    vi.restoreAllMocks();
  });

  function stubRenderMocks(): void {
    mockExistsSync.mockReturnValue(true);
    mockExtractVersion.mockReturnValue('1.2.3');
    mockLoadChangelogEntries.mockReturnValue({
      status: 'loaded',
      rejectedCount: 0,
      entries: [
        {
          version: '1.2.3',
          date: '2024-01-01',
          sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
        },
      ],
    });
    mockMatchesAudience.mockReturnValue(() => true);
    mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
  }

  it('returns both injected README and standalone release notes when markers are present', () => {
    stubRenderMocks();

    const readme = '# Package\n\n<!-- section:release-notes --><!-- /section:release-notes -->\n\n## Installation\n';
    const result = renderInjectedReadme(readme, '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result.status).toBe('rendered');
    const rendered = result.status === 'rendered' ? result.renderedReadme : undefined;
    expect(rendered?.injectedReadme).toContain('## Release notes — v1.2.3 (2024-01-01)');
    expect(rendered?.injectedReadme).toContain('### Features');
    expect(rendered?.injectedReadme).toContain('## Installation');
    expect(rendered?.releaseNotesMarkdown).toBe(
      '## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- Add widget',
    );
    // The wrapper does not write; neither does the pure renderer.
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('prepends a release-notes section when markers are absent', () => {
    stubRenderMocks();

    const readme = '# Package\n\n## Installation\n';
    const result = renderInjectedReadme(readme, '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result.status).toBe('rendered');
    const rendered = result.status === 'rendered' ? result.renderedReadme : undefined;
    expect(rendered?.injectedReadme.startsWith('<!-- section:release-notes -->')).toBe(true);
    expect(rendered?.injectedReadme).toContain('# Package');
  });

  it('returns a missing-file skip when changelog.json does not exist', () => {
    mockLoadChangelogEntries.mockReturnValue({ status: 'missing' });

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'missing-file' } });
  });

  it('returns an unreadable-file skip when changelog.json is unparseable', () => {
    mockLoadChangelogEntries.mockReturnValue({ status: 'unreadable', reason: 'Unexpected token' });

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'unreadable-file' } });
  });

  it('returns a no-entry skip when the changelog does not contain an entry matching the version', () => {
    mockExistsSync.mockReturnValue(true);
    mockExtractVersion.mockReturnValue('9.9.9');
    mockLoadChangelogEntries.mockReturnValue({
      status: 'loaded',
      rejectedCount: 0,
      entries: [{ version: '1.0.0', date: '2024-01-01', sections: [] }],
    });

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v9.9.9');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'no-entry', version: '9.9.9' } });
  });

  it('returns an empty-body skip when all sections are dev-only', () => {
    stubRenderMocks();
    mockRenderReleaseNotesSingle.mockReturnValue('');

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toStrictEqual({ status: 'skipped', skip: { reason: 'empty-body', version: '1.2.3' } });
  });

  it('forwards sectionOrder to the renderer when provided', () => {
    stubRenderMocks();

    renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3', ['Bug fixes', 'Features']);

    expect(mockRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', () => {
    stubRenderMocks();

    renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    const renderOptions = mockRenderReleaseNotesSingle.mock.calls[0]?.[1];
    expect(renderOptions).not.toHaveProperty('sectionOrder');
  });
});

describe(renderInjectedReadmeFromEntries, () => {
  const entries: readonly ChangelogEntry[] = [
    {
      version: '1.2.3',
      date: '2024-01-01',
      sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
    },
  ];

  beforeEach(() => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockMatchesAudience.mockReturnValue(() => true);
    mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
  });

  afterEach(() => {
    mockExtractVersion.mockReset();
    mockMatchesAudience.mockReset();
    mockRenderReleaseNotesSingle.mockReset();
    vi.restoreAllMocks();
  });

  it('returns the injected README and the standalone markdown when the entry renders', () => {
    const result = renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v1.2.3');

    expect(result).toStrictEqual({
      status: 'rendered',
      renderedReadme: {
        injectedReadme: expect.stringContaining('### Features'),
        releaseNotesMarkdown: '## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- Add widget',
      },
    });
  });

  it('reports no-entry with the version when the tag does not match any entry', () => {
    mockExtractVersion.mockReturnValue('9.9.9');

    const result = renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v9.9.9');

    expect(result).toStrictEqual({ status: 'skipped', reason: 'no-entry', version: '9.9.9' });
  });

  it('reports empty-body with the version when the entry renders nothing', () => {
    mockRenderReleaseNotesSingle.mockReturnValue('');

    const result = renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v1.2.3');

    expect(result).toStrictEqual({ status: 'skipped', reason: 'empty-body', version: '1.2.3' });
  });

  it('reports a skip through its return value rather than the console', () => {
    using silencedConsole = silenceConsole(['warn']);
    mockRenderReleaseNotesSingle.mockReturnValue('');

    renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v1.2.3');
    mockExtractVersion.mockReturnValue('9.9.9');
    renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v9.9.9');

    expect(silencedConsole.warn).not.toHaveBeenCalled();
  });
});

describe(resolveReadmePath, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
  });

  it('returns the README path when it exists', () => {
    mockExistsSync.mockReturnValue(true);

    expect(resolveReadmePath('/pkg')).toBe('/pkg/README.md');
  });

  it('returns undefined when the package does not have a README', () => {
    mockExistsSync.mockReturnValue(false);

    expect(resolveReadmePath('/pkg')).toBeUndefined();
  });
});
