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
        components: [{ dir: 'arrays' }, { dir: 'strings', tagPrefix: 'str-v', shouldExclude: false }],
      });
      expect(errors).toStrictEqual([]);
      expect(config.components).toHaveLength(2);
    });

    it('returns an error when components is not an array', () => {
      const { errors } = validateConfig({ components: 'invalid' });
      expect(errors).toContain("'components' must be an array");
    });

    it('returns an error when dir is missing', () => {
      const { errors } = validateConfig({ components: [{ tagPrefix: 'test-v' }] });
      expect(errors).toContain("components[0]: 'dir' is required");
    });

    it('returns an error when shouldExclude is not a boolean', () => {
      const { errors } = validateConfig({
        components: [{ dir: 'arrays', shouldExclude: 'yes' }],
      });
      expect(errors).toContain("components[0]: 'shouldExclude' must be a boolean");
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

    it('validates workspaceAliases as a string record', () => {
      const { config, errors } = validateConfig({ workspaceAliases: { api: 'backend-api' } });
      expect(errors).toStrictEqual([]);
      expect(config.workspaceAliases).toStrictEqual({ api: 'backend-api' });
    });

    it('returns an error when workspaceAliases values are not strings', () => {
      const { errors } = validateConfig({ workspaceAliases: { api: 123 } });
      expect(errors).toContain('workspaceAliases.api: value must be a string');
    });
  });
});
