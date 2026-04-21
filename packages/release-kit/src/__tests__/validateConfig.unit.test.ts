import { describe, expect, it } from 'vitest';

import { validateConfig } from '../validateConfig.ts';

describe(validateConfig, () => {
  it('returns no errors for an empty config object', () => {
    const { errors } = validateConfig({});
    expect(errors).toStrictEqual([]);
  });

  it('returns an error for a non-object config', () => {
    const { errors } = validateConfig('invalid');
    expect(errors).toContain('Config must be an object');
  });

  it('returns an error for unknown fields', () => {
    const { errors } = validateConfig({ unknownField: true });
    expect(errors).toContain("Unknown field: 'unknownField'");
  });

  describe('components', () => {
    it('validates a valid components array', () => {
      const { config, errors } = validateConfig({
        components: [{ dir: 'arrays' }, { dir: 'strings', shouldExclude: false }],
      });
      expect(errors).toStrictEqual([]);
      expect(config.components).toHaveLength(2);
    });

    it('returns an error when components is not an array', () => {
      const { errors } = validateConfig({ components: 'invalid' });
      expect(errors).toContain("'components' must be an array");
    });

    it('returns an error when dir is missing', () => {
      const { errors } = validateConfig({ components: [{ shouldExclude: true }] });
      expect(errors).toContain("components[0]: 'dir' is required");
    });

    it('returns an error when shouldExclude is not a boolean', () => {
      const { errors } = validateConfig({
        components: [{ dir: 'arrays', shouldExclude: 'yes' }],
      });
      expect(errors).toContain("components[0]: 'shouldExclude' must be a boolean");
    });

    it('returns a deprecation error when tagPrefix is present', () => {
      const { errors } = validateConfig({
        components: [{ dir: 'arrays', tagPrefix: 'my-v' }],
      });
      expect(errors).toContain(
        "components[0]: 'tagPrefix' is no longer supported; remove it to use the default 'arrays-v'",
      );
    });

    it('returns an error for unknown component fields', () => {
      const { errors } = validateConfig({
        components: [{ dir: 'arrays', bogusField: true }],
      });
      expect(errors).toContain("components[0]: unknown field 'bogusField'");
    });

    describe('legacyTagPrefixes', () => {
      it('accepts a string array', () => {
        const { config, errors } = validateConfig({
          components: [{ dir: 'core', legacyTagPrefixes: ['core-v', 'old-core-v'] }],
        });
        expect(errors).toStrictEqual([]);
        expect(config.components?.[0]?.legacyTagPrefixes).toStrictEqual(['core-v', 'old-core-v']);
      });

      it('accepts an empty array', () => {
        const { config, errors } = validateConfig({
          components: [{ dir: 'core', legacyTagPrefixes: [] }],
        });
        expect(errors).toStrictEqual([]);
        expect(config.components?.[0]?.legacyTagPrefixes).toStrictEqual([]);
      });

      it('omits legacyTagPrefixes from the result when the field is not provided', () => {
        const { config, errors } = validateConfig({
          components: [{ dir: 'core' }],
        });
        expect(errors).toStrictEqual([]);
        expect(config.components?.[0]?.legacyTagPrefixes).toBeUndefined();
      });

      it('returns an error when legacyTagPrefixes is not an array', () => {
        const { errors } = validateConfig({
          components: [{ dir: 'core', legacyTagPrefixes: 'core-v' }],
        });
        expect(errors).toContain("components[0]: 'legacyTagPrefixes' must be a string array");
      });

      it('returns a per-index error when an entry is not a string', () => {
        const { errors } = validateConfig({
          components: [{ dir: 'core', legacyTagPrefixes: ['core-v', 123, 'old-v'] }],
        });
        expect(errors).toContain('components[0].legacyTagPrefixes[1]: must be a string');
      });

      it('returns a per-index error when an entry is an empty string', () => {
        const { errors } = validateConfig({
          components: [{ dir: 'core', legacyTagPrefixes: ['core-v', ''] }],
        });
        expect(errors).toContain('components[0].legacyTagPrefixes[1]: must be a non-empty string');
      });
    });
  });

  describe('versionPatterns', () => {
    it('validates a valid versionPatterns object', () => {
      const { config, errors } = validateConfig({
        versionPatterns: { major: ['!'], minor: ['feat'] },
      });
      expect(errors).toStrictEqual([]);
      expect(config.versionPatterns).toStrictEqual({ major: ['!'], minor: ['feat'] });
    });

    it('returns an error when major is not a string array', () => {
      const { errors } = validateConfig({
        versionPatterns: { major: 'invalid', minor: ['feat'] },
      });
      expect(errors).toContain('versionPatterns.major: expected string array');
    });

    it('returns an error when minor is not a string array', () => {
      const { errors } = validateConfig({
        versionPatterns: { major: ['!'], minor: 123 },
      });
      expect(errors).toContain('versionPatterns.minor: expected string array');
    });

    it('returns an error and does not set config.versionPatterns when only major is valid', () => {
      const { config, errors } = validateConfig({
        versionPatterns: { major: ['!'], minor: 'invalid' },
      });
      expect(errors).toContain('versionPatterns.minor: expected string array');
      expect(config.versionPatterns).toBeUndefined();
    });

    it('returns an error and does not set config.versionPatterns when only minor is valid', () => {
      const { config, errors } = validateConfig({
        versionPatterns: { major: 123, minor: ['feat'] },
      });
      expect(errors).toContain('versionPatterns.major: expected string array');
      expect(config.versionPatterns).toBeUndefined();
    });
  });

  describe('workTypes', () => {
    it('validates a valid workTypes record', () => {
      const { config, errors } = validateConfig({
        workTypes: { perf: { header: 'Performance' } },
      });
      expect(errors).toStrictEqual([]);
      expect(config.workTypes).toStrictEqual({ perf: { header: 'Performance' } });
    });

    it('validates workTypes with aliases', () => {
      const { config, errors } = validateConfig({
        workTypes: { perf: { header: 'Performance', aliases: ['performance'] } },
      });
      expect(errors).toStrictEqual([]);
      expect(config.workTypes?.perf?.aliases).toStrictEqual(['performance']);
    });

    it('returns an error when workTypes is an array', () => {
      const { errors } = validateConfig({ workTypes: [] });
      expect(errors).toContain("'workTypes' must be a record (object)");
    });

    it('returns an error when header is missing', () => {
      const { errors } = validateConfig({
        workTypes: { perf: { aliases: ['performance'] } },
      });
      expect(errors).toContain("workTypes.perf: 'header' is required and must be a string");
    });
  });

  describe('scalar fields', () => {
    it('validates formatCommand as a string', () => {
      const { config, errors } = validateConfig({ formatCommand: 'pnpm run fmt' });
      expect(errors).toStrictEqual([]);
      expect(config.formatCommand).toBe('pnpm run fmt');
    });

    it('returns an error when formatCommand is not a string', () => {
      const { errors } = validateConfig({ formatCommand: 123 });
      expect(errors).toContain("'formatCommand' must be a string");
    });

    it('validates cliffConfigPath as a string', () => {
      const { config, errors } = validateConfig({ cliffConfigPath: 'custom/cliff.toml' });
      expect(errors).toStrictEqual([]);
      expect(config.cliffConfigPath).toBe('custom/cliff.toml');
    });

    it('validates scopeAliases as a string record', () => {
      const { config, errors } = validateConfig({ scopeAliases: { api: 'backend-api' } });
      expect(errors).toStrictEqual([]);
      expect(config.scopeAliases).toStrictEqual({ api: 'backend-api' });
    });

    it('returns an error when scopeAliases values are not strings', () => {
      const { errors } = validateConfig({ scopeAliases: { api: 123 } });
      expect(errors).toContain('scopeAliases.api: value must be a string');
    });
  });

  describe('changelogJson', () => {
    it('validates a complete changelogJson object', () => {
      const { config, errors } = validateConfig({
        changelogJson: { enabled: true, outputPath: '.meta/changelog.json', devOnlySections: ['CI'] },
      });
      expect(errors).toStrictEqual([]);
      expect(config.changelogJson).toStrictEqual({
        enabled: true,
        outputPath: '.meta/changelog.json',
        devOnlySections: ['CI'],
      });
    });

    it('validates a partial changelogJson object', () => {
      const { config, errors } = validateConfig({ changelogJson: { enabled: false } });
      expect(errors).toStrictEqual([]);
      expect(config.changelogJson).toStrictEqual({ enabled: false });
    });

    it('returns an error when changelogJson is not an object', () => {
      const { errors } = validateConfig({ changelogJson: 'invalid' });
      expect(errors).toContain("'changelogJson' must be an object");
    });

    it('returns an error when enabled is not a boolean', () => {
      const { errors } = validateConfig({ changelogJson: { enabled: 'yes' } });
      expect(errors).toContain('changelogJson.enabled: must be a boolean');
    });

    it('returns an error when outputPath is not a string', () => {
      const { errors } = validateConfig({ changelogJson: { outputPath: 123 } });
      expect(errors).toContain('changelogJson.outputPath: must be a string');
    });

    it('returns an error when devOnlySections is not a string array', () => {
      const { errors } = validateConfig({ changelogJson: { devOnlySections: [1, 2] } });
      expect(errors).toContain('changelogJson.devOnlySections: must be a string array');
    });

    it('returns an error for unknown changelogJson fields', () => {
      const { errors } = validateConfig({ changelogJson: { bogus: true } });
      expect(errors).toContain("changelogJson: unknown field 'bogus'");
    });
  });

  describe('releaseNotes', () => {
    it('validates a complete releaseNotes object', () => {
      const { config, errors } = validateConfig({
        releaseNotes: { shouldInjectIntoReadme: true },
      });
      expect(errors).toStrictEqual([]);
      expect(config.releaseNotes).toStrictEqual({
        shouldInjectIntoReadme: true,
      });
    });

    it('returns an error when releaseNotes is not an object', () => {
      const { errors } = validateConfig({ releaseNotes: 'invalid' });
      expect(errors).toContain("'releaseNotes' must be an object");
    });

    it('returns an error when shouldInjectIntoReadme is not a boolean', () => {
      const { errors } = validateConfig({ releaseNotes: { shouldInjectIntoReadme: 'yes' } });
      expect(errors).toContain('releaseNotes.shouldInjectIntoReadme: must be a boolean');
    });

    it('returns a targeted migration error when shouldCreateGithubRelease is set', () => {
      const { errors } = validateConfig({ releaseNotes: { shouldCreateGithubRelease: true } });
      expect(errors).toContain(
        'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow. Remove this field from your config; see README for the updated workflow.',
      );
    });

    it('returns an error for unknown releaseNotes fields', () => {
      const { errors } = validateConfig({ releaseNotes: { unknownField: true } });
      expect(errors).toContain("releaseNotes: unknown field 'unknownField'");
    });
  });

  describe('cross-field warnings', () => {
    it('warns when shouldInjectIntoReadme is true but changelogJson is disabled', () => {
      const { warnings } = validateConfig({
        changelogJson: { enabled: false },
        releaseNotes: { shouldInjectIntoReadme: true },
      });
      expect(warnings).toContain(
        'releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false; README injection will be skipped at runtime',
      );
    });

    it('returns no warnings when config is consistent', () => {
      const { warnings } = validateConfig({
        changelogJson: { enabled: true },
        releaseNotes: { shouldInjectIntoReadme: true },
      });
      expect(warnings).toStrictEqual([]);
    });

    it('returns no warnings for empty config', () => {
      const { warnings } = validateConfig({});
      expect(warnings).toStrictEqual([]);
    });
  });
});
