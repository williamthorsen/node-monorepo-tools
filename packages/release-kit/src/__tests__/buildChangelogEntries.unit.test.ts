import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { matchesAudience, renderReleaseNotesSingle } from '../renderReleaseNotes.ts';
import type { ChangelogEntry, ChangelogJsonConfig, ReleaseConfig } from '../types.ts';

// Mock execFileSync to avoid actually running git-cliff.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock filesystem so the `.template` path's tempdir handling is exercised without touching disk.
const mockMkdtempSync = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  copyFileSync: mockCopyFileSync,
  mkdtempSync: mockMkdtempSync,
  rmSync: mockRmSync,
  writeFileSync: mockWriteFileSync,
}));

// Mock resolveCliffConfigPath to return a dummy path.
vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: () => '/fake/cliff.toml',
}));

const { execFileSync } = await import('node:child_process');
const { buildChangelogEntries } = await import('../buildChangelogEntries.ts');

const mockedExecFileSync = vi.mocked(execFileSync);

const defaultChangelogJsonConfig: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: ['CI', 'Dependencies', 'Internal', 'Refactoring', 'Tests', 'Tooling'],
};

function makeConfig(
  overrides?: Partial<ChangelogJsonConfig>,
): Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'> {
  return {
    changelogJson: { ...defaultChangelogJsonConfig, ...overrides },
  };
}

describe(buildChangelogEntries, () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
    mockMkdtempSync.mockReset();
    mockCopyFileSync.mockReset();
    mockRmSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transforms git-cliff context into ChangelogEntry array', () => {
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1_700_000_000,
        commits: [
          { message: '#1 feat: Add new feature', group: 'Features' },
          { message: '#2 fix: Fix a bug', group: 'Bug fixes' },
          { message: '#3 ci: Update pipeline', group: 'CI' },
        ],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(entries[0]?.sections).toHaveLength(3);

    const features = entries[0]?.sections.find((s) => s.title === 'Features');
    expect(features?.audience).toBe('all');
    expect(features?.items[0]?.description).toBe('Add new feature');

    const ci = entries[0]?.sections.find((s) => s.title === 'CI');
    expect(ci?.audience).toBe('dev');
  });

  it('omits releases without version', () => {
    const cliffContext = [
      { commits: [{ message: '#1 feat: Unreleased', group: 'Features' }] },
      {
        version: 'v1.0.0',
        timestamp: 1_700_000_000,
        commits: [{ message: '#2 feat: Released', group: 'Features' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
  });

  it('tags sections with correct audience based on devOnlySections', () => {
    const cliffContext = [
      {
        version: 'v2.0.0',
        timestamp: 1_700_000_000,
        commits: [
          { message: '#1 feat: Feature', group: 'Features' },
          { message: '#2 deps: Bump deps', group: 'Dependencies' },
          { message: '#3 tests: Add test', group: 'Tests' },
          { message: '#4 fix: Bug fix', group: 'Bug fixes' },
        ],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig(), 'v2.0.0');

    const audiences = Object.fromEntries(entries[0]?.sections.map((s) => [s.title, s.audience]) ?? []);
    expect(audiences).toStrictEqual({
      Features: 'all',
      Dependencies: 'dev',
      Tests: 'dev',
      'Bug fixes': 'all',
    });
  });

  it('classifies emoji-prefixed section titles against bare-name devOnlySections overrides', () => {
    // A consumer override written as `devOnlySections: ['Internal']` (bare) must keep matching the
    // emoji-prefixed default title `'🏗️ Internal'` produced by the bundled cliff template, so
    // upgrading does not silently reclassify their sections.
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1_700_000_000,
        commits: [
          { message: '#1 feat: User-facing thing', group: '🎉 Features' },
          { message: '#2 internal: Plumbing change', group: '🏗️ Internal' },
          { message: '#3 deps: Bump deps', group: '📦 Dependencies' },
        ],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig({ devOnlySections: ['Internal', 'Dependencies'] }), 'v1.0.0');

    const audiences = Object.fromEntries(entries[0]?.sections.map((s) => [s.title, s.audience]) ?? []);
    expect(audiences).toStrictEqual({
      '🎉 Features': 'all',
      '🏗️ Internal': 'dev',
      '📦 Dependencies': 'dev',
    });
  });

  it('preserves full first line when commit message has no colon separator', () => {
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1_700_000_000,
        commits: [{ message: 'Initial commit', group: 'Other' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');

    expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Initial commit');
  });

  it('always invokes git-cliff and never writes the changelog file', () => {
    // Pins the intentional dry-run behavioral change: `buildChangelogEntries` does not short-
    // circuit. The caller's `dryRun` controls only the persistence step (writeChangelogJson /
    // upsertChangelogJson), not the cliff invocation. This test asserts:
    //   1. execFileSync IS called (git-cliff runs).
    //   2. writeFileSync is NOT called (no file is written by this helper).
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1_700_000_000,
        commits: [{ message: '#1 feat: Add widget', group: 'Features' }],
      },
    ];
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');

    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  describe('breaking marker', () => {
    it('sets breaking: true for a `feat!:` commit', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 feat!: Redesign API', group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('omits breaking for a `feat:` commit (no `!`)', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 feat: Add widget', group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });

    it('sets breaking: true for a `drop!:` commit', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 drop!: Remove legacy endpoint', group: 'Removed' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('sets breaking: true for a scoped `type(scope)!:` commit', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 feat(api)!: Redesign endpoint', group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('sets breaking: true for a pipe-scoped `scope|type!:` commit', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 web|feat!: Reshape API', group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]?.breaking).toBe(true);
    });

    it('does NOT set breaking when only the body footer carries `BREAKING CHANGE:` (prefix `!` is required)', () => {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message: '#1 feat: Add widget\n\nBREAKING CHANGE: removes /v1 path', group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      expect(entries[0]?.sections[0]?.items[0]).not.toHaveProperty('breaking');
    });
  });

  describe('body extraction', () => {
    function runAndReadItems(message: string): ChangelogEntry['sections'][number]['items'] {
      const cliffContext = [
        {
          version: 'v1.0.0',
          timestamp: 1_700_000_000,
          commits: [{ message, group: 'Features' }],
        },
      ];
      mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));
      const entries = buildChangelogEntries(makeConfig(), 'v1.0.0');
      return entries[0]?.sections[0]?.items ?? [];
    }

    it('omits body field when commit has no body text', () => {
      const items = runAndReadItems('#1 feat: Add widget');
      expect(items[0]).toStrictEqual({ description: 'Add widget' });
      expect(items[0]).not.toHaveProperty('body');
    });

    it('omits body field when commit message has no newline at all', () => {
      const items = runAndReadItems('#1 feat: No newline at all');
      expect(items[0]).not.toHaveProperty('body');
    });

    it('extracts single-paragraph body text', () => {
      const items = runAndReadItems('#1 feat: Add widget\n\nThis paragraph explains the widget in more detail.');
      expect(items[0]?.body).toBe('This paragraph explains the widget in more detail.');
    });

    it('extracts multi-paragraph body text preserving internal blank lines', () => {
      const message = '#1 feat: Add widget\n\nFirst paragraph of the body.\n\nSecond paragraph with more detail.';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('First paragraph of the body.\n\nSecond paragraph with more detail.');
    });

    it('strips trailing Signed-off-by trailer', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nSigned-off-by: Author <a@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing Co-authored-by trailer', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nCo-authored-by: Helper <h@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing Closes/Fixes/Resolves references', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nCloses #42\nFixes #43\nResolves #44';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips trailing bare pull-request URL', () => {
      const message = '#1 feat: Add widget\n\nBody text here.\n\nhttps://github.com/owner/repo/pull/99';
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('strips a mixed trailer block', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body text here.',
        '',
        'Co-authored-by: Helper <h@example.com>',
        'Signed-off-by: Author <a@example.com>',
        'Closes #10',
        'https://github.com/owner/repo/pull/99',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body text here.');
    });

    it('preserves mid-body trailer-lookalike lines', () => {
      const message = [
        '#1 feat: Add widget',
        '',
        'Body paragraph one mentions Closes #10 in passing.',
        '',
        'Body paragraph two.',
      ].join('\n');
      const items = runAndReadItems(message);
      expect(items[0]?.body).toBe('Body paragraph one mentions Closes #10 in passing.\n\nBody paragraph two.');
    });

    it('returns no body when message has only trailer lines', () => {
      const message = '#1 feat: Add widget\n\nSigned-off-by: Author <a@example.com>';
      const items = runAndReadItems(message);
      expect(items[0]).not.toHaveProperty('body');
    });
  });
});

describe('buildChangelogEntries + renderReleaseNotesSingle integration', () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
    mockMkdtempSync.mockReset();
    mockCopyFileSync.mockReset();
    mockRmSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders public release notes with priority-ordered sections, bodies under bullets, and no dev-only or skipped sections', () => {
    // Group names mirror the production cliff template: emoji-prefixed, matching DEFAULT_WORK_TYPES headers.
    const featHeader = DEFAULT_WORK_TYPES.feat?.header ?? 'Features';
    const fixHeader = DEFAULT_WORK_TYPES.fix?.header ?? 'Bug fixes';
    const refactorHeader = DEFAULT_WORK_TYPES.refactor?.header ?? 'Refactoring';
    const cliffContext = [
      {
        version: 'v0.17.0',
        timestamp: 1_700_000_000,
        commits: [
          // Intentionally emitted out of priority order to prove sort behavior.
          { message: '#2 feat: Add widget API\n\nIntroduces a widget API for consumers.', group: featHeader },
          {
            message: '#3 refactor: Reshape internals\n\nConsolidates helper modules.',
            group: refactorHeader,
          },
          {
            message:
              '#1 fix: Fix crash on startup\n\nFixes a regression that crashed the app when the config file was missing.\n\nSigned-off-by: Author <a@example.com>',
            group: fixHeader,
          },
        ],
      },
    ];
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    const entries = buildChangelogEntries(
      makeConfig({ devOnlySections: DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections }),
      'v0.17.0',
    );
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    // Template intentionally skips `fmt:` commits; confirm no Formatting section ever reaches the JSON.
    const sectionTitles = entry.sections.map((section) => section.title);
    expect(sectionTitles).not.toContain('Formatting');

    const sectionOrder = Object.values(DEFAULT_WORK_TYPES).map((config) => config.header);

    const rendered = renderReleaseNotesSingle(entry, {
      filter: matchesAudience('all'),
      includeHeading: false,
      sectionOrder,
    });

    // Public release notes: Features before Bug fixes (canonical Public-tier order), no Refactoring, no Formatting.
    // Emoji-tolerant matching: the contract is "a Features section appears before a Bug fixes section",
    // independent of the specific decorative emoji prefix in the header.
    const bugFixesIndex = rendered.search(/### (?:\S+ )?Bug fixes\b/);
    const featuresIndex = rendered.search(/### (?:\S+ )?Features\b/);
    expect(featuresIndex).toBeGreaterThanOrEqual(0);
    expect(bugFixesIndex).toBeGreaterThan(featuresIndex);
    expect(rendered).not.toMatch(/### (?:\S+ )?Refactoring\b/);
    expect(rendered).not.toMatch(/### (?:\S+ )?Formatting\b/);

    // Body text renders as two-space-indented paragraphs under the bullet, and signed-off-by is stripped.
    expect(rendered).toContain(
      '- Fix crash on startup\n\n  Fixes a regression that crashed the app when the config file was missing.',
    );
    expect(rendered).toContain('- Add widget API\n\n  Introduces a widget API for consumers.');
    expect(rendered).not.toContain('Signed-off-by');
  });
});
