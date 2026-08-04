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

import { planReleaseNotesPreviews, writeReleaseNotesPreviews } from '../writeReleaseNotesPreviews.ts';

describe(planReleaseNotesPreviews, () => {
  beforeEach(() => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Pkg\n');
    mockRenderInjectedReadmeFromEntries.mockReturnValue({
      injectedReadme: '# Pkg\n### Features\n\n- X\n',
      releaseNotesMarkdown: '## Release notes — v1.2.3 (2024-01-01)\n\n### Features\n\n- X',
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
    mockRenderInjectedReadmeFromEntries.mockReturnValue(undefined);

    const plan = planReleaseNotesPreviews(previewOptions());

    expect(plan.writes).toStrictEqual([]);
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

describe(writeReleaseNotesPreviews, () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileWithCheck.mockReset();
    mockRenderInjectedReadme.mockReset();
    mockExtractVersion.mockReset();
    vi.restoreAllMocks();
  });

  function setupRenderOk(): void {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Pkg\n<!-- section:release-notes --><!-- /section:release-notes -->\n');
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '# Pkg\n<!-- section:release-notes -->\n### Features\n\n- X\n<!-- /section:release-notes -->\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'created' });
  }

  it('writes both preview files under docs/ with versioned names', () => {
    setupRenderOk();

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: ['Features'],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(2);
    const calls = mockWriteFileWithCheck.mock.calls;
    const firstPath = calls[0]?.[0];
    const secondPath = calls[1]?.[0];
    expect(firstPath).toBe('/ws/docs/README.v1.2.3.md');
    expect(secondPath).toBe('/ws/docs/RELEASE_NOTES.v1.2.3.md');
    expect(result.injectedReadme?.outcome).toBe('created');
    expect(result.releaseNotes?.outcome).toBe('created');
  });

  it('passes overwrite:true so existing files are replaced', () => {
    setupRenderOk();
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'overwritten' });

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    expect(result.injectedReadme?.outcome).toBe('overwritten');
    expect(result.releaseNotes?.outcome).toBe('overwritten');
    for (const call of mockWriteFileWithCheck.mock.calls) {
      expect(call[2]).toStrictEqual({ dryRun: false, overwrite: true });
    }
  });

  it('skips the injected README preview when the workspace has no README.md but still writes the standalone file', () => {
    mockExtractVersion.mockReturnValue('1.2.3');
    // README.md does not exist; nothing else calls existsSync in this flow.
    mockExistsSync.mockReturnValue(false);
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '<!-- section:release-notes -->\n### Features\n\n- X\n<!-- /section:release-notes -->\n\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'created' });

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);
    expect(result.injectedReadme?.outcome).toBe('skipped-no-readme');
    // Only the release-notes file is written.
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(1);
    expect(mockWriteFileWithCheck.mock.calls[0]?.[0]).toBe('/ws/docs/RELEASE_NOTES.v1.2.3.md');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('passes an empty-string readme to the renderer when README.md is missing', () => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(false);
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '<!-- section:release-notes -->\n### Features\n\n- X\n<!-- /section:release-notes -->\n\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'created' });

    writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    const call = mockRenderInjectedReadme.mock.calls[0];
    expect(call?.[0]).toBe('');
  });

  it('writes nothing and returns renderSkipped when the renderer returns undefined', () => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Pkg\n');
    mockRenderInjectedReadme.mockReturnValue(undefined);

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(true);
    expect(result.injectedReadme).toBeUndefined();
    expect(result.releaseNotes).toBeUndefined();
    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    // `renderInjectedReadme` emits its own specific skip reason; `writeReleaseNotesPreviews`
    // no longer emits a redundant outer warning.
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('skipping release-notes previews'));
  });

  it('logs planned writes in dry-run mode and creates no files', () => {
    setupRenderOk();

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: true,
    });

    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    expect(result.injectedReadme?.outcome).toBe('dry-run');
    expect(result.releaseNotes?.outcome).toBe('dry-run');
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would write /ws/docs/README.v1.2.3.md'),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would write /ws/docs/RELEASE_NOTES.v1.2.3.md'),
    );
  });

  it('forwards sectionOrder to the renderer', () => {
    setupRenderOk();

    writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: ['Bug fixes', 'Features'],
      dryRun: false,
    });

    const call = mockRenderInjectedReadme.mock.calls[0];
    expect(call?.[3]).toStrictEqual(['Bug fixes', 'Features']);
  });

  it('writes the standalone file with a trailing newline even when the rendered notes lack one', () => {
    setupRenderOk();
    // Rendered notes have no trailing newline (as produced by the trimmed renderer output).
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '# Pkg\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });

    writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    const standaloneCall = mockWriteFileWithCheck.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('RELEASE_NOTES.v1.2.3.md'),
    );
    expect(standaloneCall).toBeDefined();
    expect(standaloneCall?.[1]).toBe('### Features\n\n- X\n');
  });

  it('treats the README as unreadable when readFileSync throws and skips only the injected preview', () => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '<!-- section:release-notes -->\n### Features\n\n- X\n<!-- /section:release-notes -->\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'created' });

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    expect(result.renderSkipped).toBe(false);
    expect(result.injectedReadme?.outcome).toBe('skipped-no-readme');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to read'));
    // Suppresses the generic "not found" warning when the file existed but was unreadable.
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('not found'));
    // Only the standalone file is written.
    expect(mockWriteFileWithCheck).toHaveBeenCalledTimes(1);
    expect(mockWriteFileWithCheck.mock.calls[0]?.[0]).toBe('/ws/docs/RELEASE_NOTES.v1.2.3.md');
  });

  it('handles dry-run + missing README: writes nothing, logs dry-run for standalone, warns about missing README', () => {
    mockExtractVersion.mockReturnValue('1.2.3');
    mockExistsSync.mockReturnValue(false);
    mockRenderInjectedReadme.mockReturnValue({
      injectedReadme: '<!-- section:release-notes -->\n### Features\n\n- X\n<!-- /section:release-notes -->\n',
      releaseNotesMarkdown: '### Features\n\n- X',
    });

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: true,
    });

    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
    expect(result.injectedReadme?.outcome).toBe('skipped-no-readme');
    expect(result.releaseNotes?.outcome).toBe('dry-run');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found; skipping injected-README preview'));
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would write /ws/docs/RELEASE_NOTES.v1.2.3.md'),
    );
    expect(console.info).not.toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would write /ws/docs/README.v1.2.3.md'),
    );
  });

  it('records a failure outcome and logs an error when writeFileWithCheck fails', () => {
    setupRenderOk();
    mockWriteFileWithCheck.mockReturnValue({ filePath: '', outcome: 'failed', error: 'EACCES' });

    const result = writeReleaseNotesPreviews({
      workspacePath: '/ws',
      tag: 'pkg-v1.2.3',
      changelogJsonPath: '/ws/.meta/changelog.json',
      sectionOrder: [],
      dryRun: false,
    });

    expect(result.injectedReadme?.outcome).toBe('failed');
    expect(result.injectedReadme?.error).toBe('EACCES');
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Failed to write'));
  });
});
