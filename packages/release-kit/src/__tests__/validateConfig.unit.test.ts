import { describe, expect, it } from 'vitest';

import { expectErrorAtPath, expectErrorMentioning } from '../test-utils/validationErrors.ts';
import { validateConfig } from '../validateConfig.ts';

describe(validateConfig, () => {
  it("doesn't return any errors for an empty config object", () => {
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
        // Schema validation is all-or-nothing per field: When any entry is invalid, the
        // whole `workspaces` field fails parse and downstream consumers don't receive any
        // config at all.
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
      // The colliding entry still appears in `config.retiredPackages`: The entry is structurally valid, so the schema
      // parse succeeds, and the collision is a post-parse cross-field check that reports an error without rejecting
      // the parsed config.
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
      // Schema validation is all-or-nothing per field: When any entry is invalid, the
      // whole `retiredPackages` field fails parse and downstream consumers don't receive any
      // config at all.
      expect(config.retiredPackages).toBeUndefined();
    });
  });
});
