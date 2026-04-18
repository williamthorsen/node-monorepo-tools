import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG, DEFAULT_WORK_TYPES } from '../defaults.ts';

const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());

vi.mock('../loadConfig.ts', async () => {
  const actual = await vi.importActual<typeof import('../loadConfig.ts')>('../loadConfig.ts');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
  };
});

vi.mock('../validateConfig.ts', () => ({
  validateConfig: mockValidateConfig,
}));

import { resolveReleaseNotesConfig } from '../resolveReleaseNotesConfig.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(resolveReleaseNotesConfig, () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
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

    let thrown: ExitError | undefined;
    try {
      await resolveReleaseNotesConfig();
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Invalid config:');
    expect(console.error).toHaveBeenCalledWith("  \u274C Unknown field: 'bogus'");
  });

  it('logs each warning from validateConfig', async () => {
    mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
    mockValidateConfig.mockReturnValue({
      config: { releaseNotes: { shouldCreateGithubRelease: true } },
      errors: [],
      warnings: [
        'releaseNotes.shouldCreateGithubRelease is enabled but changelogJson.enabled is false',
        'another warning',
      ],
    });

    await resolveReleaseNotesConfig();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('shouldCreateGithubRelease is enabled'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('another warning'));
  });

  it('merges releaseNotes with defaults and resolves changelogJsonOutputPath', async () => {
    mockLoadConfig.mockResolvedValue({
      releaseNotes: { shouldCreateGithubRelease: true },
      changelogJson: { outputPath: 'custom/changelog.json' },
    });
    mockValidateConfig.mockReturnValue({
      config: {
        releaseNotes: { shouldCreateGithubRelease: true },
        changelogJson: { outputPath: 'custom/changelog.json' },
      },
      errors: [],
      warnings: [],
    });

    const result = await resolveReleaseNotesConfig();

    expect(result).toStrictEqual({
      releaseNotes: {
        ...DEFAULT_RELEASE_NOTES_CONFIG,
        shouldCreateGithubRelease: true,
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

    // `fix` appears at its default index (0), but its header is overridden to 'Fixes'.
    expect(result.sectionOrder[0]).toBe('Fixes');
    // `chore` is a new key, appended at the end.
    expect(result.sectionOrder.at(-1)).toBe('Chores');
    // Other defaults are preserved between.
    expect(result.sectionOrder).toContain('Features');
    expect(result.sectionOrder).not.toContain('Bug fixes');
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
