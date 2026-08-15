import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { stripEmojiPrefix } from '../stripEmojiPrefix.ts';

const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../loadConfig.ts'), async () => {
  const actual = await vi.importActual<typeof import('../loadConfig.ts')>('../loadConfig.ts');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
  };
});

vi.mock(import('../validateConfig.ts'), () => ({
  validateConfig: mockValidateConfig,
}));

import { resolveReleaseNotesConfig } from '../resolveReleaseNotesConfig.ts';

describe(resolveReleaseNotesConfig, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    throwOnProcessExit();
    silenceConsole(['warn']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockLoadConfig.mockReset();
    mockValidateConfig.mockReset();
    vi.restoreAllMocks();
  });

  const defaultSectionOrder = Object.values(DEFAULT_WORK_TYPES).map((entry) => entry.header);

  it('returns defaults when loadConfig throws', async () => {
    mockLoadConfig.mockRejectedValue(new Error('config read failure'));

    const result = await resolveReleaseNotesConfig();

    expect(result).toStrictEqual({
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
      sectionOrder: defaultSectionOrder,
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to load config'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('config read failure'));
  });

  it('exits with code 1 when loadConfig throws and strictLoad is true', async () => {
    mockLoadConfig.mockRejectedValue(new Error('config read failure'));

    const error = await captureError(ProcessExitError, () => resolveReleaseNotesConfig({ strictLoad: true }));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Failed to load config: config read failure\n');
  });

  it('returns defaults when raw config is undefined', async () => {
    mockLoadConfig.mockResolvedValue(undefined);

    const result = await resolveReleaseNotesConfig();

    expect(result).toStrictEqual({
      releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
      changelogJsonOutputPath: DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
      sectionOrder: defaultSectionOrder,
    });
    expect(mockValidateConfig).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when validateConfig returns errors', async () => {
    mockLoadConfig.mockResolvedValue({ bogus: 123 });
    mockValidateConfig.mockReturnValue({
      config: {},
      errors: ["Unknown field: 'bogus'"],
      warnings: [],
    });

    const error = await captureError(ProcessExitError, () => resolveReleaseNotesConfig());

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Invalid config:\n');
    expect(capture.stderrChunks).toContain("  \u{274C} Unknown field: 'bogus'\n");
  });

  it('logs each warning from validateConfig', async () => {
    mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
    mockValidateConfig.mockReturnValue({
      config: { releaseNotes: { shouldInjectIntoReadme: true } },
      errors: [],
      warnings: [
        'releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false',
        'another warning',
      ],
    });

    await resolveReleaseNotesConfig();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('shouldInjectIntoReadme is enabled'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('another warning'));
  });

  it('merges releaseNotes with defaults and resolves changelogJsonOutputPath', async () => {
    mockLoadConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: true },
      changelogJson: { outputPath: 'custom/changelog.json' },
    });
    mockValidateConfig.mockReturnValue({
      config: {
        releaseNotes: { shouldInjectIntoReadme: true },
        changelogJson: { outputPath: 'custom/changelog.json' },
      },
      errors: [],
      warnings: [],
    });

    const result = await resolveReleaseNotesConfig();

    expect(result).toStrictEqual({
      releaseNotes: {
        ...DEFAULT_RELEASE_NOTES_CONFIG,
        shouldInjectIntoReadme: true,
      },
      changelogJsonOutputPath: 'custom/changelog.json',
      sectionOrder: defaultSectionOrder,
    });
  });

  it('uses default workTypes header order for sectionOrder when config omits workTypes', async () => {
    mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
    mockValidateConfig.mockReturnValue({
      config: { releaseNotes: {} },
      errors: [],
      warnings: [],
    });

    const result = await resolveReleaseNotesConfig();

    expect(result.sectionOrder).toStrictEqual(defaultSectionOrder);
  });

  it('overrides default header and appends net-new consumer keys to sectionOrder', async () => {
    mockLoadConfig.mockResolvedValue({});
    mockValidateConfig.mockReturnValue({
      config: {
        workTypes: {
          fix: { header: 'Fixes' },
          chore: { header: 'Chores' },
        },
      },
      errors: [],
      warnings: [],
    });

    const result = await resolveReleaseNotesConfig();

    // `fix` appears at its canonical index, but its header is overridden to 'Fixes'.
    const fixIndex = Object.keys(DEFAULT_WORK_TYPES).indexOf('fix');
    expect(result.sectionOrder[fixIndex]).toBe('Fixes');
    // `chore` is a new key, appended at the end.
    expect(result.sectionOrder.at(-1)).toBe('Chores');
    // Other defaults are preserved between (compared on their bare form so the assertion is
    // independent of any decorative emoji prefix in the default header).
    const bareSectionOrder = result.sectionOrder.map(stripEmojiPrefix);
    expect(bareSectionOrder).toContain('Features');
    expect(bareSectionOrder).not.toContain('Bug fixes');
  });

  it('uses default changelogJsonOutputPath when config omits changelogJson', async () => {
    mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
    mockValidateConfig.mockReturnValue({
      config: { releaseNotes: {} },
      errors: [],
      warnings: [],
    });

    const result = await resolveReleaseNotesConfig();

    expect(result.changelogJsonOutputPath).toBe(DEFAULT_CHANGELOG_JSON_CONFIG.outputPath);
  });
});
