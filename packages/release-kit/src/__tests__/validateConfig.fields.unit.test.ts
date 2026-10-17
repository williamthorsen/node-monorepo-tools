import { describe, expect, it } from 'vitest';

import { expectErrorAtPath, expectErrorMentioning } from '../test-utils/validationErrors.ts';
import { validateConfig } from '../validateConfig.ts';

describe(validateConfig, () => {
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
      expectErrorAtPath(errors, 'versionPatterns.major');
    });

    it('returns an error when minor is not a string array', () => {
      const { errors } = validateConfig({
        versionPatterns: { major: ['!'], minor: 123 },
      });
      expectErrorAtPath(errors, 'versionPatterns.minor');
    });

    it('returns an error and does not set config.versionPatterns when only major is valid', () => {
      const { config, errors } = validateConfig({
        versionPatterns: { major: ['!'], minor: 'invalid' },
      });
      expectErrorAtPath(errors, 'versionPatterns.minor');
      expect(config.versionPatterns).toBeUndefined();
    });

    it('returns an error and does not set config.versionPatterns when only minor is valid', () => {
      const { config, errors } = validateConfig({
        versionPatterns: { major: 123, minor: ['feat'] },
      });
      expectErrorAtPath(errors, 'versionPatterns.major');
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
      expect(config.workTypes?.['perf']?.aliases).toStrictEqual(['performance']);
    });

    it('returns an error when workTypes is an array', () => {
      const { errors } = validateConfig({ workTypes: [] });
      expectErrorAtPath(errors, 'workTypes');
    });

    it('returns an error when header is missing', () => {
      const { errors } = validateConfig({
        workTypes: { perf: { aliases: ['performance'] } },
      });
      expectErrorAtPath(errors, 'workTypes.perf.header');
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
      expectErrorAtPath(errors, 'formatCommand');
    });

    it('returns a targeted migration error when cliffConfigPath is set', () => {
      const { errors } = validateConfig({ cliffConfigPath: 'custom/changelog.toml' });
      expect(errors).toStrictEqual([
        'cliffConfigPath is no longer supported. release-kit reads changelog history from git directly and does not use any external config file. Remove this field from the config, and delete the file that it names.',
      ]);
    });

    it('validates scopeAliases as a string record', () => {
      const { config, errors } = validateConfig({ scopeAliases: { api: 'backend-api' } });
      expect(errors).toStrictEqual([]);
      expect(config.scopeAliases).toStrictEqual({ api: 'backend-api' });
    });

    it('returns an error when scopeAliases values are not strings', () => {
      const { errors } = validateConfig({ scopeAliases: { api: 123 } });
      expectErrorAtPath(errors, 'scopeAliases.api');
    });
  });

  describe('breakingPolicies', () => {
    it('accepts a record covering both policy literals', () => {
      const { config, errors } = validateConfig({
        breakingPolicies: { feat: 'forbidden', fix: 'optional' },
      });
      expect(errors).toStrictEqual([]);
      expect(config.breakingPolicies).toStrictEqual({ feat: 'forbidden', fix: 'optional' });
    });

    it('rejects the retired `required` policy', () => {
      const { errors } = validateConfig({ breakingPolicies: { drop: 'required' } });
      expectErrorAtPath(errors, 'breakingPolicies.drop');
    });

    it('accepts an empty object as the documented opt-out', () => {
      const { config, errors } = validateConfig({ breakingPolicies: {} });
      expect(errors).toStrictEqual([]);
      expect(config.breakingPolicies).toStrictEqual({});
    });

    it('returns an error when breakingPolicies is not an object', () => {
      const { config, errors } = validateConfig({ breakingPolicies: 'invalid' });
      expectErrorAtPath(errors, 'breakingPolicies');
      expect(config.breakingPolicies).toBeUndefined();
    });

    it('returns an error when breakingPolicies is an array', () => {
      const { config, errors } = validateConfig({ breakingPolicies: [] });
      expectErrorAtPath(errors, 'breakingPolicies');
      expect(config.breakingPolicies).toBeUndefined();
    });

    it('returns an error naming the offending field when a value is not a known policy literal', () => {
      const { config, errors } = validateConfig({ breakingPolicies: { feat: 'sometimes' } });
      expectErrorAtPath(errors, 'breakingPolicies.feat');
      expect(config.breakingPolicies).toBeUndefined();
    });

    it('returns an error when a value is not a string', () => {
      const { config, errors } = validateConfig({ breakingPolicies: { feat: 123 } });
      expectErrorAtPath(errors, 'breakingPolicies.feat');
      expect(config.breakingPolicies).toBeUndefined();
    });

    it('rejects the entire map when any entry is invalid', () => {
      const { config, errors } = validateConfig({
        breakingPolicies: { feat: 'forbidden', drop: 'maybe' },
      });
      expectErrorAtPath(errors, 'breakingPolicies.drop');
      expect(config.breakingPolicies).toBeUndefined();
    });
  });

  describe('project', () => {
    it('accepts an empty project block', () => {
      const { config, errors } = validateConfig({ project: {} });
      expect(errors).toStrictEqual([]);
      expect(config.project).toStrictEqual({});
    });

    it('accepts a project block with a tagPrefix', () => {
      const { config, errors } = validateConfig({ project: { tagPrefix: 'release-v' } });
      expect(errors).toStrictEqual([]);
      expect(config.project).toStrictEqual({ tagPrefix: 'release-v' });
    });

    it('accepts a project block with paths', () => {
      const { config, errors } = validateConfig({ project: { paths: ['**'] } });
      expect(errors).toStrictEqual([]);
      expect(config.project).toStrictEqual({ paths: ['**'] });
    });

    it('returns an error when paths is empty', () => {
      const { errors } = validateConfig({ project: { paths: [] } });
      expectErrorAtPath(errors, 'project.paths');
    });

    it('returns an error when paths contains a non-string', () => {
      const { errors } = validateConfig({ project: { paths: [42] } });
      expectErrorAtPath(errors, 'project.paths[0]');
    });

    it('returns an error when paths contains an empty string', () => {
      const { errors } = validateConfig({ project: { paths: [''] } });
      expect(errors).toContain('project.paths[0]: must be a non-empty string');
    });

    it('returns an error when project is not an object', () => {
      const { errors } = validateConfig({ project: 'v' });
      expectErrorAtPath(errors, 'project');
    });

    it('returns an error when tagPrefix is not a string', () => {
      const { errors } = validateConfig({ project: { tagPrefix: 42 } });
      expectErrorAtPath(errors, 'project.tagPrefix');
    });

    it('returns an error when tagPrefix is an empty string', () => {
      const { errors } = validateConfig({ project: { tagPrefix: '' } });
      expect(errors).toContain('project.tagPrefix: must be a non-empty string');
    });

    it('returns an error for unknown subfields', () => {
      const { errors } = validateConfig({ project: { tagPrefix: 'v', bogus: true } });
      expectErrorMentioning(errors, 'bogus');
    });

    it('omits project from the result when the field is not provided', () => {
      const { config, errors } = validateConfig({});
      expect(errors).toStrictEqual([]);
      expect(config.project).toBeUndefined();
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

    it("doesn't return any warnings when config is consistent", () => {
      const { warnings } = validateConfig({
        changelogJson: { enabled: true },
        releaseNotes: { shouldInjectIntoReadme: true },
      });
      expect(warnings).toStrictEqual([]);
    });

    it("doesn't return any warnings for empty config", () => {
      const { warnings } = validateConfig({});
      expect(warnings).toStrictEqual([]);
    });
  });

  describe('releases', () => {
    it('accepts every entry shape', () => {
      const { config, errors } = validateConfig({
        releases: {
          core: { path: 'packages/core', legacyIdentities: [{ name: '@scope/old-core', tagPrefix: 'old-core-v' }] },
          scratch: false,
          suite: { includes: ['core'], tagPrefix: 'suite-v' },
        },
      });
      expect(errors).toStrictEqual([]);
      expect(config.releases).toStrictEqual({
        core: { path: 'packages/core', legacyIdentities: [{ name: '@scope/old-core', tagPrefix: 'old-core-v' }] },
        scratch: false,
        suite: { includes: ['core'], tagPrefix: 'suite-v' },
      });
    });

    it('rejects paths on any entry with a message naming what replaces it', () => {
      const { errors } = validateConfig({
        releases: { core: { path: 'packages/core', paths: ['src'] }, suite: { includes: ['core'], paths: ['.'] } },
      });
      expect(errors).toStrictEqual([
        "releases.core: 'paths' is not supported; a package's or a directory's commit window is its path, and a composite's is the union of its members' windows",
        "releases.suite: 'paths' is not supported; a package's or a directory's commit window is its path, and a composite's is the union of its members' windows",
      ]);
    });

    it('reports an empty includes at the includes path', () => {
      const { errors } = validateConfig({ releases: { suite: { includes: [] } } });
      expectErrorAtPath(errors, 'releases.suite.includes');
    });

    it('reports an unknown key on a path entry at the entry path', () => {
      const { errors } = validateConfig({ releases: { core: { path: 'packages/core', members: ['cli'] } } });
      expect(errors).toHaveLength(1);
      expectErrorMentioning(errors, 'members');
    });

    it('accepts a tagPrefix on a path entry', () => {
      const { errors } = validateConfig({ releases: { app: { path: 'apps/app', tagPrefix: 'app-v' } } });
      expect(errors).toStrictEqual([]);
    });

    it('names the entry shapes when an entry matches none of them', () => {
      const { errors } = validateConfig({ releases: { core: true } });
      expect(errors).toStrictEqual([
        'releases.core: must be false, { path, tagPrefix?, legacyIdentities? }, or { includes, tagPrefix? }',
      ]);
    });

    it('rejects releases combined with workspaces and project', () => {
      const { errors } = validateConfig({
        releases: { scratch: false },
        workspaces: [{ dir: 'scratch' }],
        project: {},
      });
      expect(errors).toStrictEqual([
        'releases cannot be combined with workspaces or project; declare every target under releases, or remove releases',
      ]);
    });

    it('rejects duplicate legacy identities on a releases entry', () => {
      const identity = { name: '@scope/old-core', tagPrefix: 'old-core-v' };
      const { errors } = validateConfig({
        releases: { core: { path: 'packages/core', legacyIdentities: [identity, identity] } },
      });
      expect(errors).toStrictEqual([
        "releases.core.legacyIdentities[1]: duplicate identity (name='@scope/old-core', tagPrefix='old-core-v')",
      ]);
    });

    it('rejects a retired package whose prefix a releases entry declares as a legacy identity', () => {
      const { errors } = validateConfig({
        releases: { core: { path: 'packages/core', legacyIdentities: [{ name: '@scope/x', tagPrefix: 'x-v' }] } },
        retiredPackages: [{ name: '@scope/x', tagPrefix: 'x-v' }],
      });
      expect(errors).toStrictEqual([
        "retiredPackages[0]: tagPrefix 'x-v' collides with a declared legacyIdentities[].tagPrefix on release 'core'",
      ]);
    });
  });
});
