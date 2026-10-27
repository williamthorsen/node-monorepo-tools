import { describe, expect, it } from 'vitest';

import { expectErrorAtPath, expectErrorMentioning } from '../test-utils/validationErrors.ts';
import { validateConfig } from '../validateConfig.ts';

describe(validateConfig, () => {
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

  describe('changelogMarkdown', () => {
    it('validates a changelogMarkdown object', () => {
      const { config, errors } = validateConfig({ changelogMarkdown: { keptVersionCount: 10 } });
      expect(errors).toStrictEqual([]);
      expect(config.changelogMarkdown).toStrictEqual({ keptVersionCount: 10 });
    });

    it('returns an error when keptVersionCount is less than 1', () => {
      const { errors } = validateConfig({ changelogMarkdown: { keptVersionCount: 0 } });
      expectErrorAtPath(errors, 'changelogMarkdown.keptVersionCount');
    });

    it('returns an error when keptVersionCount is not an integer', () => {
      const { errors } = validateConfig({ changelogMarkdown: { keptVersionCount: 2.5 } });
      expectErrorAtPath(errors, 'changelogMarkdown.keptVersionCount');
    });

    it('returns a targeted migration error when keepVersions is set', () => {
      const { errors } = validateConfig({ changelogMarkdown: { keepVersions: 5 } });
      expect(errors).toStrictEqual([
        'changelogMarkdown.keepVersions has been renamed. Rename it to changelogMarkdown.keptVersionCount in the config.',
      ]);
    });

    it('returns an error for unknown changelogMarkdown fields', () => {
      const { errors } = validateConfig({ changelogMarkdown: { bogus: true } });
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
        'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow, which `release-kit init` scaffolds. Remove this field from the config.',
      );
    });

    it('returns an error for unknown releaseNotes fields', () => {
      const { errors } = validateConfig({ releaseNotes: { unknownField: true } });
      expectErrorMentioning(errors, 'unknownField');
    });
  });

  describe('repoLabels', () => {
    it('validates a valid repoLabels block with extends, additions, replacements, and removals', () => {
      const { config, errors } = validateConfig({
        repoLabels: {
          extends: ['common'],
          labels: {
            'scope:nmr': { color: '00ff96', description: 'nmr package' },
            bug: { color: 'd73a4a', description: 'Something broken' },
            wontfix: null,
          },
        },
      });
      expect(errors).toStrictEqual([]);
      expect(config.repoLabels?.extends).toStrictEqual(['common']);
      expect(config.repoLabels?.labels?.['wontfix']).toBeNull();
    });

    it('accepts an empty repoLabels block', () => {
      const { errors } = validateConfig({ repoLabels: {} });
      expect(errors).toStrictEqual([]);
    });

    it('returns an error when extends is not an array of strings', () => {
      const { errors } = validateConfig({ repoLabels: { extends: 'common' } });
      expectErrorAtPath(errors, 'repoLabels.extends');
    });

    it('accepts a label entry that omits the description', () => {
      const { config, errors } = validateConfig({ repoLabels: { labels: { 'scope:nmr': { color: '00ff96' } } } });
      expect(errors).toStrictEqual([]);
      expect(config.repoLabels?.labels?.['scope:nmr']).toStrictEqual({ color: '00ff96' });
    });

    it('accepts a label entry marked as archived', () => {
      const { config, errors } = validateConfig({
        repoLabels: { labels: { 'scope:basic': { color: '00ff96', archived: true } } },
      });
      expect(errors).toStrictEqual([]);
      expect(config.repoLabels?.labels?.['scope:basic']).toStrictEqual({ color: '00ff96', archived: true });
    });

    it.each([false, 'true', 1])('returns an error when a label entry sets archived to %j', (archived) => {
      const { errors } = validateConfig({ repoLabels: { labels: { 'scope:basic': { color: '00ff96', archived } } } });
      expectErrorAtPath(errors, 'repoLabels.labels.scope:basic.archived');
    });

    it('accepts a label entry that declares aliases', () => {
      const { config, errors } = validateConfig({
        repoLabels: { labels: { 'scope:core': { color: '00ff96', aliases: ['scope:basic'] } } },
      });
      expect(errors).toStrictEqual([]);
      expect(config.repoLabels?.labels?.['scope:core']).toStrictEqual({ color: '00ff96', aliases: ['scope:basic'] });
    });

    it.each([[[]], [['']], ['scope:basic']])('returns an error when a label entry sets aliases to %j', (aliases) => {
      const { errors } = validateConfig({ repoLabels: { labels: { 'scope:core': { color: '00ff96', aliases } } } });
      expect(errors.some((error) => error.startsWith('repoLabels.labels.scope:core.aliases'))).toBe(true);
    });

    it('returns an error when a label entry is missing the color', () => {
      const { errors } = validateConfig({ repoLabels: { labels: { bug: { description: 'Something broken' } } } });
      expectErrorAtPath(errors, 'repoLabels.labels.bug.color');
    });

    it('returns an error when a label entry contains an unknown field', () => {
      const { errors } = validateConfig({
        repoLabels: { labels: { bug: { color: 'd73a4a', description: 'x', override: true } } },
      });
      expectErrorMentioning(errors, 'override');
    });

    it('returns an error for unknown keys in the repoLabels block', () => {
      const { errors } = validateConfig({ repoLabels: { exclude: ['wontfix'] } });
      expectErrorMentioning(errors, 'exclude');
    });
  });
});
