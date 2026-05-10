import { describe, expect, it } from 'vitest';

import { validateConfig } from '../validateConfig.ts';

/**
 * Assert that at least one error in `errors` is attributed to the given field path. Used
 * for cases where the validator's responsibility is to catch the input at the right path
 * — the message text itself is Zod's default and should not be pinned to a specific
 * wording (Zod minor versions can shift wording without our code changing).
 *
 * For errors with messages we own (deprecation messages, duplicate-detection messages,
 * collision messages, cross-field warnings, our targeted "must be a non-empty string"
 * customization), use `expect(errors).toContain('exact message')` instead.
 */
function expectErrorAtPath(errors: readonly string[], path: string): void {
  const matched = errors.some((e) => e.startsWith(`${path}:`));
  expect(matched, `expected an error at path '${path}'\nactual errors:\n  ${errors.join('\n  ')}`).toBe(true);
}

/**
 * Assert that at least one error in `errors` mentions the given substring. Used for
 * top-level errors that have no path prefix (e.g., a top-level `Unrecognized key: "X"`
 * from Zod's `.strict()` check) where we want to confirm the validator surfaced the
 * offending key without pinning the wording.
 */
function expectErrorMentioning(errors: readonly string[], substring: string): void {
  const matched = errors.some((e) => e.includes(substring));
  expect(matched, `expected an error mentioning '${substring}'\nactual errors:\n  ${errors.join('\n  ')}`).toBe(true);
}

describe(validateConfig, () => {
  it('returns no errors for an empty config object', () => {
    const { errors } = validateConfig({});
    expect(errors).toStrictEqual([]);
  });

  it('returns an error for a non-object config', () => {
    const { errors } = validateConfig('invalid');
    expect(errors).toContain('Config must be an object');
  });

  it('returns an error for unknown top-level fields', () => {
    const { errors } = validateConfig({ unknownField: true });
    expectErrorMentioning(errors, 'unknownField');
  });

  describe('workspaces', () => {
    it('validates a valid workspaces array', () => {
      const { config, errors } = validateConfig({
        workspaces: [{ dir: 'arrays' }, { dir: 'strings', shouldExclude: false }],
      });
      expect(errors).toStrictEqual([]);
      expect(config.workspaces).toHaveLength(2);
    });

    it('returns an error when workspaces is not an array', () => {
      const { errors } = validateConfig({ workspaces: 'invalid' });
      expectErrorAtPath(errors, 'workspaces');
    });

    it('returns an error when dir is missing', () => {
      const { errors } = validateConfig({ workspaces: [{ shouldExclude: true }] });
      expectErrorAtPath(errors, 'workspaces[0].dir');
    });

    it('returns an error when shouldExclude is not a boolean', () => {
      const { errors } = validateConfig({
        workspaces: [{ dir: 'arrays', shouldExclude: 'yes' }],
      });
      expectErrorAtPath(errors, 'workspaces[0].shouldExclude');
    });

    it('returns a deprecation error when tagPrefix is present', () => {
      const { errors } = validateConfig({
        workspaces: [{ dir: 'arrays', tagPrefix: 'my-v' }],
      });
      expect(errors).toContain(
        "workspaces[0]: 'tagPrefix' is no longer supported; remove it to use the default 'arrays-v'",
      );
    });

    it('returns an error for unknown workspace fields', () => {
      const { errors } = validateConfig({
        workspaces: [{ dir: 'arrays', bogusField: true }],
      });
      expectErrorMentioning(errors, 'bogusField');
    });

    describe('legacyIdentities', () => {
      it('accepts an array of complete identity objects', () => {
        const { config, errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyIdentities: [
                { name: '@scope/core', tagPrefix: 'core-v' },
                { name: '@old-scope/core', tagPrefix: 'old-core-v' },
              ],
            },
          ],
        });
        expect(errors).toStrictEqual([]);
        expect(config.workspaces?.[0]?.legacyIdentities).toStrictEqual([
          { name: '@scope/core', tagPrefix: 'core-v' },
          { name: '@old-scope/core', tagPrefix: 'old-core-v' },
        ]);
      });

      it('accepts an empty array', () => {
        const { config, errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [] }],
        });
        expect(errors).toStrictEqual([]);
        expect(config.workspaces?.[0]?.legacyIdentities).toStrictEqual([]);
      });

      it('omits legacyIdentities from the result when the field is not provided', () => {
        const { config, errors } = validateConfig({
          workspaces: [{ dir: 'core' }],
        });
        expect(errors).toStrictEqual([]);
        expect(config.workspaces?.[0]?.legacyIdentities).toBeUndefined();
      });

      it('returns an error when legacyIdentities is not an array', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: 'core-v' }],
        });
        expectErrorAtPath(errors, 'workspaces[0].legacyIdentities');
      });

      it('returns a per-index error when an entry is not an object', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: ['core-v'] }],
        });
        expectErrorAtPath(errors, 'workspaces[0].legacyIdentities[0]');
      });

      it('returns a per-index error when name is missing', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ tagPrefix: 'core-v' }] }],
        });
        expectErrorAtPath(errors, 'workspaces[0].legacyIdentities[0].name');
      });

      it('returns a per-index error when name is an empty string', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ name: '', tagPrefix: 'core-v' }] }],
        });
        expect(errors).toContain('workspaces[0].legacyIdentities[0].name: must be a non-empty string');
      });

      it('returns a per-index error when tagPrefix is missing', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@scope/core' }] }],
        });
        expectErrorAtPath(errors, 'workspaces[0].legacyIdentities[0].tagPrefix');
      });

      it('returns a per-index error when tagPrefix is an empty string', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@scope/core', tagPrefix: '' }] }],
        });
        expect(errors).toContain('workspaces[0].legacyIdentities[0].tagPrefix: must be a non-empty string');
      });

      it('returns an error on unknown identity fields', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@scope/core', tagPrefix: 'core-v', bogus: true }] }],
        });
        expectErrorMentioning(errors, 'bogus');
      });

      it('rejects full-tuple duplicates', () => {
        const { errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyIdentities: [
                { name: '@scope/core', tagPrefix: 'core-v' },
                { name: '@scope/core', tagPrefix: 'core-v' },
              ],
            },
          ],
        });
        expect(errors).toContain(
          "workspaces[0].legacyIdentities[1]: duplicate identity (name='@scope/core', tagPrefix='core-v')",
        );
      });

      it('accepts two entries with the same tagPrefix but different names', () => {
        const { config, errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyIdentities: [
                { name: '@old-scope/core', tagPrefix: 'core-v' },
                { name: '@other-scope/core', tagPrefix: 'core-v' },
              ],
            },
          ],
        });
        expect(errors).toStrictEqual([]);
        expect(config.workspaces?.[0]?.legacyIdentities).toHaveLength(2);
      });

      it('emits a migration error when the removed legacyTagPrefixes field is present', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyTagPrefixes: ['core-v'] }],
        });
        expect(errors).toContain(
          "workspaces[0]: 'legacyTagPrefixes' is no longer supported; use 'legacyIdentities: [{ name, tagPrefix }, ...]' instead",
        );
      });

      it('emits a migration error and still validates legacyIdentities when both fields coexist', () => {
        const { config, errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyTagPrefixes: ['core-v'],
              legacyIdentities: [{ name: '@scope/core', tagPrefix: 'old-core-v' }],
            },
          ],
        });
        expect(errors).toContain(
          "workspaces[0]: 'legacyTagPrefixes' is no longer supported; use 'legacyIdentities: [{ name, tagPrefix }, ...]' instead",
        );
        expect(config.workspaces?.[0]?.legacyIdentities).toStrictEqual([
          { name: '@scope/core', tagPrefix: 'old-core-v' },
        ]);
      });

      it('rejects the entire workspaces array when any legacyIdentities entry is invalid', () => {
        const { config, errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyIdentities: [
                { name: '@scope/core', tagPrefix: 'core-v' },
                'core-v',
                { name: '@other-scope/core', tagPrefix: 'other-core-v' },
              ],
            },
          ],
        });
        expectErrorAtPath(errors, 'workspaces[0].legacyIdentities[1]');
        // Schema validation is all-or-nothing per field: when any entry is invalid, the
        // whole `workspaces` field fails parse and downstream consumers see no config at all.
        expect(config.workspaces).toBeUndefined();
      });

      it('accepts tuples that would have collided under a space-separator dedup key', () => {
        const { config, errors } = validateConfig({
          workspaces: [
            {
              dir: 'core',
              legacyIdentities: [
                { name: 'foo bar', tagPrefix: 'baz-v' },
                { name: 'foo', tagPrefix: 'bar baz-v' },
              ],
            },
          ],
        });
        expect(errors).toStrictEqual([]);
        expect(config.workspaces?.[0]?.legacyIdentities).toStrictEqual([
          { name: 'foo bar', tagPrefix: 'baz-v' },
          { name: 'foo', tagPrefix: 'bar baz-v' },
        ]);
      });
    });
  });

  describe('retiredPackages', () => {
    it('accepts an array of complete retired-package objects', () => {
      const { config, errors } = validateConfig({
        retiredPackages: [
          { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' },
          { name: '@scope/dead', tagPrefix: 'dead-v' },
        ],
      });
      expect(errors).toStrictEqual([]);
      expect(config.retiredPackages).toStrictEqual([
        { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' },
        { name: '@scope/dead', tagPrefix: 'dead-v' },
      ]);
    });

    it('accepts an empty array', () => {
      const { config, errors } = validateConfig({ retiredPackages: [] });
      expect(errors).toStrictEqual([]);
      expect(config.retiredPackages).toStrictEqual([]);
    });

    it('omits retiredPackages from the result when the field is not provided', () => {
      const { config, errors } = validateConfig({});
      expect(errors).toStrictEqual([]);
      expect(config.retiredPackages).toBeUndefined();
    });

    it('returns an error when retiredPackages is not an array', () => {
      const { errors } = validateConfig({ retiredPackages: 'preflight-v' });
      expectErrorAtPath(errors, 'retiredPackages');
    });

    it('returns a per-index error when an entry is not an object', () => {
      const { errors } = validateConfig({ retiredPackages: ['preflight-v'] });
      expectErrorAtPath(errors, 'retiredPackages[0]');
    });

    it('returns a per-index error when name is missing', () => {
      const { errors } = validateConfig({ retiredPackages: [{ tagPrefix: 'preflight-v' }] });
      expectErrorAtPath(errors, 'retiredPackages[0].name');
    });

    it('returns a per-index error when name is an empty string', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '', tagPrefix: 'preflight-v' }] });
      expect(errors).toContain('retiredPackages[0].name: must be a non-empty string');
    });

    it('returns a per-index error when tagPrefix is missing', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '@scope/preflight' }] });
      expectErrorAtPath(errors, 'retiredPackages[0].tagPrefix');
    });

    it('returns a per-index error when tagPrefix is an empty string', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '@scope/preflight', tagPrefix: '' }] });
      expect(errors).toContain('retiredPackages[0].tagPrefix: must be a non-empty string');
    });

    it('returns a per-index error when successor is not a string', () => {
      const { errors } = validateConfig({
        retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 42 }],
      });
      expectErrorAtPath(errors, 'retiredPackages[0].successor');
    });

    it('returns a per-index error when successor is an empty string', () => {
      const { errors } = validateConfig({
        retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', successor: '' }],
      });
      expect(errors).toContain('retiredPackages[0].successor: must be a non-empty string');
    });

    it('returns an error on unknown retired-package fields', () => {
      const { errors } = validateConfig({
        retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', bogus: true }],
      });
      expectErrorMentioning(errors, 'bogus');
    });

    it('rejects full-tuple duplicates', () => {
      const { errors } = validateConfig({
        retiredPackages: [
          { name: '@scope/preflight', tagPrefix: 'preflight-v' },
          { name: '@scope/preflight', tagPrefix: 'preflight-v' },
        ],
      });
      expect(errors).toContain(
        "retiredPackages[1]: duplicate package (name='@scope/preflight', tagPrefix='preflight-v')",
      );
    });

    it('accepts two entries with the same tagPrefix but different names', () => {
      const { config, errors } = validateConfig({
        retiredPackages: [
          { name: '@old-scope/preflight', tagPrefix: 'preflight-v' },
          { name: '@new-scope/preflight', tagPrefix: 'preflight-v' },
        ],
      });
      expect(errors).toStrictEqual([]);
      expect(config.retiredPackages).toHaveLength(2);
    });

    it('rejects a tagPrefix colliding with a declared legacyIdentities[].tagPrefix', () => {
      const { config, errors } = validateConfig({
        workspaces: [
          {
            dir: 'core',
            legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'old-core-v' }],
          },
        ],
        retiredPackages: [{ name: '@scope/retired', tagPrefix: 'old-core-v' }],
      });
      expect(errors).toContain(
        "retiredPackages[0]: tagPrefix 'old-core-v' collides with a declared legacyIdentities[].tagPrefix on workspace 'core'",
      );
      // The colliding entry is still written to `config.retiredPackages` — the schema-level
      // parse succeeds (the entry is structurally valid); the collision is a post-parse
      // cross-field check that surfaces an error without rejecting the parsed config.
      expect(config.retiredPackages).toStrictEqual([{ name: '@scope/retired', tagPrefix: 'old-core-v' }]);
    });

    it('records the collision when retired and legacy tagPrefixes match across workspaces', () => {
      const { config, errors } = validateConfig({
        workspaces: [
          {
            dir: 'arrays',
            legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'shared-v' }],
          },
          {
            dir: 'strings',
            legacyIdentities: [{ name: '@old-scope/strings', tagPrefix: 'shared-v' }],
          },
        ],
        retiredPackages: [{ name: '@scope/retired', tagPrefix: 'shared-v' }],
      });
      // Preserves the first declaring workspace in the error.
      expect(errors).toContain(
        "retiredPackages[0]: tagPrefix 'shared-v' collides with a declared legacyIdentities[].tagPrefix on workspace 'arrays'",
      );
      expect(config.retiredPackages).toStrictEqual([{ name: '@scope/retired', tagPrefix: 'shared-v' }]);
    });

    it('rejects the entire retiredPackages array when any entry is invalid', () => {
      const { config, errors } = validateConfig({
        retiredPackages: [
          { name: '@scope/preflight', tagPrefix: 'preflight-v' },
          'not-an-object',
          { name: '@scope/dead', tagPrefix: 'dead-v', successor: 'alive' },
        ],
      });
      expectErrorAtPath(errors, 'retiredPackages[1]');
      // Schema validation is all-or-nothing per field: when any entry is invalid, the
      // whole `retiredPackages` field fails parse and downstream consumers see no config at all.
      expect(config.retiredPackages).toBeUndefined();
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
      expect(config.workTypes?.perf?.aliases).toStrictEqual(['performance']);
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
      expectErrorAtPath(errors, 'scopeAliases.api');
    });
  });

  describe('breakingPolicies', () => {
    it('accepts a record covering all three policy literals', () => {
      const { config, errors } = validateConfig({
        breakingPolicies: { feat: 'forbidden', drop: 'required', fix: 'optional' },
      });
      expect(errors).toStrictEqual([]);
      expect(config.breakingPolicies).toStrictEqual({ feat: 'forbidden', drop: 'required', fix: 'optional' });
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
      expectErrorAtPath(errors, 'changelogJson');
    });

    it('returns an error when enabled is not a boolean', () => {
      const { errors } = validateConfig({ changelogJson: { enabled: 'yes' } });
      expectErrorAtPath(errors, 'changelogJson.enabled');
    });

    it('returns an error when outputPath is not a string', () => {
      const { errors } = validateConfig({ changelogJson: { outputPath: 123 } });
      expectErrorAtPath(errors, 'changelogJson.outputPath');
    });

    it('returns an error when devOnlySections is not a string array', () => {
      const { errors } = validateConfig({ changelogJson: { devOnlySections: [1, 2] } });
      expectErrorAtPath(errors, 'changelogJson.devOnlySections[0]');
    });

    it('returns an error for unknown changelogJson fields', () => {
      const { errors } = validateConfig({ changelogJson: { bogus: true } });
      expectErrorMentioning(errors, 'bogus');
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
      expectErrorAtPath(errors, 'releaseNotes');
    });

    it('returns an error when shouldInjectIntoReadme is not a boolean', () => {
      const { errors } = validateConfig({ releaseNotes: { shouldInjectIntoReadme: 'yes' } });
      expectErrorAtPath(errors, 'releaseNotes.shouldInjectIntoReadme');
    });

    it('returns a targeted migration error when shouldCreateGithubRelease is set', () => {
      const { errors } = validateConfig({ releaseNotes: { shouldCreateGithubRelease: true } });
      expect(errors).toContain(
        'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow. Remove this field from your config; see README for the updated workflow.',
      );
    });

    it('returns an error for unknown releaseNotes fields', () => {
      const { errors } = validateConfig({ releaseNotes: { unknownField: true } });
      expectErrorMentioning(errors, 'unknownField');
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
