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
      expect(errors).toContain("'workspaces' must be an array");
    });

    it('returns an error when dir is missing', () => {
      const { errors } = validateConfig({ workspaces: [{ shouldExclude: true }] });
      expect(errors).toContain("workspaces[0]: 'dir' is required");
    });

    it('returns an error when shouldExclude is not a boolean', () => {
      const { errors } = validateConfig({
        workspaces: [{ dir: 'arrays', shouldExclude: 'yes' }],
      });
      expect(errors).toContain("workspaces[0]: 'shouldExclude' must be a boolean");
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
      expect(errors).toContain("workspaces[0]: unknown field 'bogusField'");
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
        expect(errors).toContain("workspaces[0]: 'legacyIdentities' must be an array");
      });

      it('returns a per-index error when an entry is not an object', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: ['core-v'] }],
        });
        expect(errors).toContain('workspaces[0].legacyIdentities[0]: must be an object');
      });

      it('returns a per-index error when name is missing', () => {
        const { errors } = validateConfig({
          workspaces: [{ dir: 'core', legacyIdentities: [{ tagPrefix: 'core-v' }] }],
        });
        expect(errors).toContain('workspaces[0].legacyIdentities[0].name: must be a string');
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
        expect(errors).toContain('workspaces[0].legacyIdentities[0].tagPrefix: must be a string');
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
        expect(errors).toContain("workspaces[0].legacyIdentities[0]: unknown field 'bogus'");
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

      it('preserves valid entries when only some entries in a multi-entry array are invalid', () => {
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
        expect(errors).toContain('workspaces[0].legacyIdentities[1]: must be an object');
        expect(config.workspaces?.[0]?.legacyIdentities).toStrictEqual([
          { name: '@scope/core', tagPrefix: 'core-v' },
          { name: '@other-scope/core', tagPrefix: 'other-core-v' },
        ]);
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
      expect(errors).toContain("'retiredPackages' must be an array");
    });

    it('returns a per-index error when an entry is not an object', () => {
      const { errors } = validateConfig({ retiredPackages: ['preflight-v'] });
      expect(errors).toContain('retiredPackages[0]: must be an object');
    });

    it('returns a per-index error when name is missing', () => {
      const { errors } = validateConfig({ retiredPackages: [{ tagPrefix: 'preflight-v' }] });
      expect(errors).toContain('retiredPackages[0].name: must be a string');
    });

    it('returns a per-index error when name is an empty string', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '', tagPrefix: 'preflight-v' }] });
      expect(errors).toContain('retiredPackages[0].name: must be a non-empty string');
    });

    it('returns a per-index error when tagPrefix is missing', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '@scope/preflight' }] });
      expect(errors).toContain('retiredPackages[0].tagPrefix: must be a string');
    });

    it('returns a per-index error when tagPrefix is an empty string', () => {
      const { errors } = validateConfig({ retiredPackages: [{ name: '@scope/preflight', tagPrefix: '' }] });
      expect(errors).toContain('retiredPackages[0].tagPrefix: must be a non-empty string');
    });

    it('returns a per-index error when successor is not a string', () => {
      const { errors } = validateConfig({
        retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 42 }],
      });
      expect(errors).toContain('retiredPackages[0].successor: must be a string');
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
      expect(errors).toContain("retiredPackages[0]: unknown field 'bogus'");
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
      // The colliding entry is still written to `config.retiredPackages` — the returned config
      // is not guaranteed to be internally consistent when `errors` is non-empty. Callers must
      // check `errors` before trusting `config`.
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
      // The colliding entry is still present in `config.retiredPackages` under the current
      // contract (mirrors `validateWorkspaces` behavior).
      expect(config.retiredPackages).toStrictEqual([{ name: '@scope/retired', tagPrefix: 'shared-v' }]);
    });

    it('preserves valid entries when only some entries in a multi-entry array are invalid', () => {
      const { config, errors } = validateConfig({
        retiredPackages: [
          { name: '@scope/preflight', tagPrefix: 'preflight-v' },
          'not-an-object',
          { name: '@scope/dead', tagPrefix: 'dead-v', successor: 'alive' },
        ],
      });
      expect(errors).toContain('retiredPackages[1]: must be an object');
      expect(config.retiredPackages).toStrictEqual([
        { name: '@scope/preflight', tagPrefix: 'preflight-v' },
        { name: '@scope/dead', tagPrefix: 'dead-v', successor: 'alive' },
      ]);
    });

    it('reports the user-supplied index in the collision error when an earlier entry was rejected', () => {
      const { errors } = validateConfig({
        workspaces: [
          {
            dir: 'core',
            legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'old-core-v' }],
          },
        ],
        retiredPackages: [
          // Structurally invalid: bare string, rejected during per-entry validation.
          'not-an-object',
          // Valid entry whose tagPrefix collides with the legacy identity above.
          { name: '@scope/retired', tagPrefix: 'old-core-v' },
        ],
      });
      expect(errors).toContain(
        "retiredPackages[1]: tagPrefix 'old-core-v' collides with a declared legacyIdentities[].tagPrefix on workspace 'core'",
      );
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
