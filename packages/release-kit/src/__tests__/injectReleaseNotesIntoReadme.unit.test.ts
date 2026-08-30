import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());
const mockReadChangelogEntries = vi.hoisted(() => vi.fn());
const mockMatchesAudience = vi.hoisted(() => vi.fn());
const mockRenderReleaseNotesSingle = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('../changelogJsonUtils.ts'), () => ({
  extractVersion: mockExtractVersion,
  readChangelogEntries: mockReadChangelogEntries,
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
  beforeEach(() => {
    void silenceConsole(['warn']);
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
      return typeof p === 'string' && (p.endsWith('README.md') || p.endsWith('changelog.json'));
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

describe(renderInjectedReadme, () => {
  beforeEach(() => {
    void silenceConsole(['warn']);
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

  function setupRenderMocks(): void {
    mockExistsSync.mockReturnValue(true);
    mockExtractVersion.mockReturnValue('1.2.3');
    mockReadChangelogEntries.mockReturnValue([
      {
        version: '1.2.3',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
      },
    ]);
    mockMatchesAudience.mockReturnValue(() => true);
    mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
  }

  it('returns both injected README and standalone release notes when markers are present', () => {
    setupRenderMocks();

    const readme = '# Package\n\n<!-- section:release-notes --><!-- /section:release-notes -->\n\n## Installation\n';
    const result = renderInjectedReadme(readme, '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toBeDefined();
    expect(result?.injectedReadme).toContain('## Release notes — v1.2.3 (2024-01-01)');
    expect(result?.injectedReadme).toContain('### Features');
    expect(result?.injectedReadme).toContain('## Installation');
    expect(result?.releaseNotesMarkdown).toBe('## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- Add widget');
    // The wrapper does not write; neither does the pure renderer.
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('prepends a release-notes section when markers are absent', () => {
    setupRenderMocks();

    const readme = '# Package\n\n## Installation\n';
    const result = renderInjectedReadme(readme, '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toBeDefined();
    expect(result?.injectedReadme.startsWith('<!-- section:release-notes -->')).toBe(true);
    expect(result?.injectedReadme).toContain('# Package');
  });

  it('returns undefined when changelog.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Warning: /pkg/.meta/changelog.json not found; skipping README injection',
    );
  });

  it('returns undefined when changelog.json is unparseable', () => {
    mockExistsSync.mockReturnValue(true);
    mockExtractVersion.mockReturnValue('1.2.3');
    mockReadChangelogEntries.mockReturnValue(undefined);

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Warning: could not parse /pkg/.meta/changelog.json; skipping README injection',
    );
  });

  it('returns undefined when no changelog entry matches the version', () => {
    mockExistsSync.mockReturnValue(true);
    mockExtractVersion.mockReturnValue('9.9.9');
    mockReadChangelogEntries.mockReturnValue([{ version: '1.0.0', date: '2024-01-01', sections: [] }]);

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v9.9.9');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Warning: no changelog entry for version 9.9.9; skipping README injection',
    );
  });

  it('returns undefined when all sections are dev-only', () => {
    setupRenderMocks();
    mockRenderReleaseNotesSingle.mockReturnValue('');

    const result = renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3');

    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Warning: no user-facing release notes for version 1.2.3; skipping README injection',
    );
  });

  it('forwards sectionOrder to the renderer when provided', () => {
    setupRenderMocks();

    renderInjectedReadme('# README\n', '/pkg/.meta/changelog.json', 'v1.2.3', ['Bug fixes', 'Features']);

    expect(mockRenderReleaseNotesSingle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sectionOrder: ['Bug fixes', 'Features'] }),
    );
  });

  it('omits sectionOrder from render options when not provided', () => {
    setupRenderMocks();

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
      rendered: {
        injectedReadme: expect.stringContaining('### Features'),
        releaseNotesMarkdown: '## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- Add widget',
      },
    });
  });

  it('reports no-entry with the version when no entry matches the tag', () => {
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
    using silent = silenceConsole(['warn']);
    mockRenderReleaseNotesSingle.mockReturnValue('');

    renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v1.2.3');
    mockExtractVersion.mockReturnValue('9.9.9');
    renderInjectedReadmeFromEntries('# Pkg\n', entries, 'pkg-v9.9.9');

    expect(silent.warn).not.toHaveBeenCalled();
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
