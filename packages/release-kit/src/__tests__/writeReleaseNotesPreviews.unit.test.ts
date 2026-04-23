import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());
const mockRenderInjectedReadme = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('@williamthorsen/node-monorepo-core', () => ({
  writeFileWithCheck: mockWriteFileWithCheck,
}));

vi.mock('../injectReleaseNotesIntoReadme.ts', () => ({
  renderInjectedReadme: mockRenderInjectedReadme,
}));

vi.mock('../changelogJsonUtils.ts', () => ({
  extractVersion: mockExtractVersion,
}));

import { writeReleaseNotesPreviews } from '../writeReleaseNotesPreviews.ts';

describe(writeReleaseNotesPreviews, () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
      expect(call[2]).toEqual({ dryRun: false, overwrite: true });
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
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('skipping release-notes previews'));
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
    expect(call?.[3]).toEqual(['Bug fixes', 'Features']);
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
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error writing'));
  });
});
