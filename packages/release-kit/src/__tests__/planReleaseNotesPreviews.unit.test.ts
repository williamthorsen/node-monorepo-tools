import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());
const mockRenderInjectedReadme = vi.hoisted(() => vi.fn());
const mockRenderInjectedReadmeFromEntries = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => ({
  ...(await importOriginal<typeof import('@williamthorsen/nmr-core')>()),
  writeFileWithCheck: mockWriteFileWithCheck,
}));

vi.mock(import('../injectReleaseNotesIntoReadme.ts'), () => ({
  renderInjectedReadme: mockRenderInjectedReadme,
  renderInjectedReadmeFromEntries: mockRenderInjectedReadmeFromEntries,
}));

vi.mock(import('../changelogJsonUtils.ts'), () => ({
  extractVersion: mockExtractVersion,
}));

import { planReleaseNotesPreviews } from '../planReleaseNotesPreviews.ts';

describe(planReleaseNotesPreviews, () => {
  beforeEach(() => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Pkg\n');
    mockRenderInjectedReadmeFromEntries.mockReturnValue({
      status: 'rendered',
      rendered: {
        injectedReadme: '# Pkg\n### Features\n\n- X\n',
        releaseNotesMarkdown: '## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- X',
      },
    });
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileWithCheck.mockReset();
    mockRenderInjectedReadmeFromEntries.mockReset();
    mockExtractVersion.mockReset();
  });

  it('plans the injected-README preview and the standalone preview under docs/', () => {
    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.writes.map((write) => write.path)).toStrictEqual([
      'packages/a/docs/README.v1.2.3.md',
      'packages/a/docs/RELEASE_NOTES.v1.2.3.md',
    ]);
  });

  it('renders from the supplied entries rather than from a changelog file', () => {
    const entries = [{ version: '1.2.3', date: '2024-01-01', sections: [] }];

    planReleaseNotesPreviews(previewOptions({ entries }));

    expect(mockRenderInjectedReadmeFromEntries).toHaveBeenCalledWith('# Pkg\n', entries, 'pkg-v1.2.3', ['Features']);
  });

  it('if the workspace has no README, plans only the standalone preview', () => {
    mockExistsSync.mockReturnValue(false);

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.writes.map((write) => write.path)).toStrictEqual(['packages/a/docs/RELEASE_NOTES.v1.2.3.md']);
  });

  it('if the workspace has no README, warns that the injected preview was skipped', () => {
    mockExistsSync.mockReturnValue(false);

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.warnings).toStrictEqual([
      'packages/a/README.md not found; skipping injected-README preview but still writing standalone release notes',
    ]);
  });

  it('if the README exists but cannot be read, warns with the read failure', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.warnings).toStrictEqual([
      'failed to read packages/a/README.md: EACCES: permission denied; skipping injected-README preview',
    ]);
  });

  it('if the renderer reports no content for the version, plans nothing', () => {
    mockRenderInjectedReadmeFromEntries.mockReturnValue({ status: 'skipped', reason: 'no-entry', version: '1.2.3' });

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.writes).toStrictEqual([]);
  });

  it('if no changelog entry matches the version, warns naming the version', () => {
    mockRenderInjectedReadmeFromEntries.mockReturnValue({ status: 'skipped', reason: 'no-entry', version: '1.2.3' });

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.warnings).toStrictEqual(['no changelog entry for version 1.2.3; skipping release-notes previews']);
  });

  it('if the entry has no user-facing content, warns naming the version', () => {
    mockRenderInjectedReadmeFromEntries.mockReturnValue({ status: 'skipped', reason: 'empty-body', version: '1.2.3' });

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.warnings).toStrictEqual([
      'no user-facing release notes for version 1.2.3; skipping release-notes previews',
    ]);
  });

  it('words a renderer skip for previews rather than for README injection', () => {
    mockRenderInjectedReadmeFromEntries.mockReturnValue({ status: 'skipped', reason: 'empty-body', version: '1.2.3' });

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.warnings.some((warning) => warning.includes('README injection'))).toBe(false);
  });

  it('ends the standalone preview with a newline when the renderer omits one', () => {
    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.writes.at(-1)?.content).toBe('## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- X\n');
  });

  it('writes nothing', () => {
    planReleaseNotesPreviews(previewOptions());

    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });
});

/** Build preview options, overriding any field of an otherwise minimal single-workspace run. */
function previewOptions(
  overrides: Partial<Parameters<typeof planReleaseNotesPreviews>[0]> = {},
): Parameters<typeof planReleaseNotesPreviews>[0] {
  return {
    workspacePath: 'packages/a',
    tag: 'pkg-v1.2.3',
    entries: [{ version: '1.2.3', date: '2024-01-01', sections: [] }],
    sectionOrder: ['Features'],
    ...overrides,
  };
}
