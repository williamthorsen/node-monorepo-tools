import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());
const mockReadChangelogEntries = vi.hoisted(() => vi.fn());
const mockMatchesAudience = vi.hoisted(() => vi.fn());
const mockRenderReleaseNotesSingle = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../changelogJsonUtils.ts', () => ({
  extractVersion: mockExtractVersion,
  readChangelogEntries: mockReadChangelogEntries,
}));

vi.mock('../renderReleaseNotes.ts', () => ({
  matchesAudience: mockMatchesAudience,
  renderReleaseNotesSingle: mockRenderReleaseNotesSingle,
}));

import { injectReleaseNotesIntoReadme, resolveReadmePath } from '../injectReleaseNotesIntoReadme.ts';

describe(injectReleaseNotesIntoReadme, () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockExtractVersion.mockReset();
    mockReadChangelogEntries.mockReset();
    mockMatchesAudience.mockReset();
    mockRenderReleaseNotesSingle.mockReset();
    vi.restoreAllMocks();
  });

  function setupInjectionMocks(): void {
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && (p.endsWith('README.md') || p.endsWith('changelog.json'))) {
        return true;
      }
      return false;
    });
    mockReadFileSync.mockReturnValue('# Original README\n');
    mockExtractVersion.mockReturnValue('1.0.0');
    mockReadChangelogEntries.mockReturnValue([
      {
        version: '1.0.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
      },
    ]);
    mockMatchesAudience.mockReturnValue(() => true);
    mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
  }

  it('injects release notes and returns original content', () => {
    setupInjectionMocks();

    const original = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(original).toBe('# Original README\n');
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const injectedContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(typeof injectedContent === 'string' && injectedContent).toContain('Features');
  });

  it('returns undefined when changelog.json is missing', () => {
    mockExistsSync.mockReturnValue(false);

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found; skipping README injection'));
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns undefined when changelog.json is malformed', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# README\n');
    mockExtractVersion.mockReturnValue('1.0.0');
    mockReadChangelogEntries.mockReturnValue(undefined);

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not parse'));
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns undefined when no entry matches the tag version', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# README\n');
    mockExtractVersion.mockReturnValue('99.0.0');
    mockReadChangelogEntries.mockReturnValue([{ version: '1.0.0', date: '2024-01-01', sections: [] }]);

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v99.0.0');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no changelog entry for version 99.0.0'));
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns undefined when all sections are dev-only', () => {
    setupInjectionMocks();
    mockRenderReleaseNotesSingle.mockReturnValue('');

    const result = injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no user-facing release notes'));
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('forwards sectionOrder to renderReleaseNotesSingle when provided', () => {
    setupInjectionMocks();

    injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0', ['Bug fixes', 'Features']);

    expect(mockRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', () => {
    setupInjectionMocks();

    injectReleaseNotesIntoReadme('/pkg/README.md', '/pkg/.meta/changelog.json', 'v1.0.0');

    const renderOptions = mockRenderReleaseNotesSingle.mock.calls[0]?.[1];
    expect(renderOptions).not.toHaveProperty('sectionOrder');
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

  it('returns undefined when no README exists', () => {
    mockExistsSync.mockReturnValue(false);

    expect(resolveReadmePath('/pkg')).toBeUndefined();
  });
});
