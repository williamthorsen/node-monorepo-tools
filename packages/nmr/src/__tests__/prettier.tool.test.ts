import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type Config, format, getFileInfo, getSupportInfo, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { definePrettierConfig } from '../prettier.ts';

const fixturesDir = path.join(import.meta.dirname, 'fixtures');

/** A config file holding this factory's output, so Prettier's own resolution applies the overrides. */
const fixtureConfigPath = path.join(fixturesDir, 'prettier.config.mjs');

/** The same, with the Markdown carve-out overridden back to `auto` the way a consumer would. */
const fencesOnConfigPath = path.join(fixturesDir, 'prettier-fences-on.config.mjs');

/** A documented command whose angle-bracket placeholders the shell parser reads as redirections. */
const DOCUMENTED_COMMAND = [
  '```bash',
  'node emit-event.mjs \\',
  '  --type <type> \\',
  '  --harness claude \\',
  "  --payload '<json>'",
  '```',
  '',
].join('\n');

const UNFORMATTED_TS_FENCE = '```ts\nconst x = {a:1,   b:2}\n```\n';

/** The languages whose paths Prettier routes to a Markdown printer, and so whose fences the carve-out must cover. */
const MARKDOWN_LANGUAGES = new Set(['Markdown', 'MDX']);

/**
 * Paths whose extension or basename the plugin claims but this config drops. Each is a file type
 * whose content the shell parser either fails on or silently rewrites, so inferring a parser for it
 * is the defect being guarded against.
 */
const UNCLAIMED_PATHS = [
  '.bash_history',
  '.cshrc',
  '.env',
  '.flaskenv',
  '.gitignore',
  '.ics',
  '.login',
  '.prettierignore',
  '.properties',
  '.vcf',
  'CODEOWNERS',
  'cshrc',
  'gradlew',
  'hosts',
  'login',
  'mvnw',
  'thing.csh',
  'thing.nu',
];

const SHELL_PATHS = ['.bashrc', 'thing.bash', 'thing.sh', 'thing.zsh'];

describe(definePrettierConfig, () => {
  describe('shell formatting', () => {
    it('formats a shell script the way shfmt does with no flags', async () => {
      const output = await format(readFixture('messy.sh'), toFormatOptions(definePrettierConfig(), 'messy.sh'));

      expect(output).toBe(readFixture('messy.expected.sh'));
    });

    it('leaves an already-formatted shell script alone', async () => {
      const source = readFixture('messy.expected.sh');
      const output = await format(source, toFormatOptions(definePrettierConfig(), 'messy.expected.sh'));

      expect(output).toBe(source);
    });

    it('lets a caller override a pinned shfmt option', async () => {
      const config = definePrettierConfig({ spaceRedirects: true });
      const output = await format(readFixture('messy.sh'), toFormatOptions(config, 'messy.sh'));

      expect(output).toContain('echo a > out.txt');
    });
  });

  describe('language scoping', () => {
    it('adds only Dockerfile and Shell to the languages Prettier infers', async () => {
      const withPlugin = await getSupportInfo({ plugins: definePrettierConfig().plugins ?? [] });
      const withoutPlugin = await getSupportInfo({ plugins: [] });

      const added = withPlugin.languages
        .map((language) => language.name)
        .filter((name) => withoutPlugin.languages.every((language) => language.name !== name));

      expect(added.toSorted()).toStrictEqual(['Dockerfile', 'Shell']);
    });

    it.each(UNCLAIMED_PATHS)('infers no parser for %s', async (file) => {
      const info = await getFileInfo(file, { plugins: definePrettierConfig().plugins ?? [] });

      expect(info.inferredParser).toBeNull();
    });

    it.each(SHELL_PATHS)('infers the shell parser for %s', async (file) => {
      const info = await getFileInfo(file, { plugins: definePrettierConfig().plugins ?? [] });

      expect(info.inferredParser).toBe('sh');
    });

    it('infers the Dockerfile parser for a Dockerfile', async () => {
      const info = await getFileInfo('Dockerfile', { plugins: definePrettierConfig().plugins ?? [] });

      expect(info.inferredParser).toBe('dockerfile');
    });

    // Filtering `languages` while leaving `parsers` whole is what keeps this escape hatch open. `APKBUILD` infers
    // nothing, so the explicit parser is the only thing routing it to the shell printer.
    it.each(['APKBUILD', 'thing.ebuild'])('formats %s through an explicitly assigned parser', async (file) => {
      const config = definePrettierConfig();
      const output = await format('build() {\n\t\tmake\n}\n', { ...toFormatOptions(config, file), parser: 'sh' });

      expect(output).toBe('build() {\n  make\n}\n');
    });

    it('formats a Dockerfile through the inferred Dockerfile printer', async () => {
      const config = definePrettierConfig();
      const output = await format('FROM node:24-alpine   AS base\n', toFormatOptions(config, 'Dockerfile'));

      expect(output).toBe('FROM node:24-alpine AS base\n');
    });
  });

  // These resolve a real config file, the only way `overrides` apply: `format()` ignores them, so the cases built
  // on `toFormatOptions` cannot reach the Markdown carve-out at all.
  describe('embedded code in Markdown', () => {
    it.each(['README', 'doc.markdown', 'doc.md', 'doc.mdx', 'docs/deep/nested/doc.md'])(
      'leaves a documented command with angle-bracket placeholders byte-identical in %s',
      async (file) => {
        await expect(formatResolved(DOCUMENTED_COMMAND, file)).resolves.toBe(DOCUMENTED_COMMAND);
      },
    );

    // A path left out of the carve-out is rewritten silently, so the claim is read back rather than trusted to stay
    // what it was when the list was written. The count guards the read-back itself: a name that matches no language
    // would leave nothing to check and nothing to fail.
    it('covers every path Prettier routes to a Markdown printer', async () => {
      const { languages } = await getSupportInfo();
      const claimed = languages.flatMap((language) =>
        MARKDOWN_LANGUAGES.has(language.name)
          ? [...(language.extensions ?? []).map((extension) => `doc${extension}`), ...(language.filenames ?? [])]
          : [],
      );

      expect(claimed).toHaveLength(14);

      const settings = await Promise.all(
        claimed.map(async (file) => {
          const options = await resolveConfig(path.join(fixturesDir, file), { config: fixtureConfigPath });

          return { file, setting: options?.embeddedLanguageFormatting };
        }),
      );

      expect(settings.filter(({ setting }) => setting !== 'off').map(({ file }) => file)).toStrictEqual([]);
    });

    it('leaves a fence tagged for a language other than shell alone', async () => {
      await expect(formatResolved(UNFORMATTED_TS_FENCE, 'doc.md')).resolves.toBe(UNFORMATTED_TS_FENCE);
    });

    it('lets a consumer re-enable fence formatting through a later override', async () => {
      const output = await formatResolved(UNFORMATTED_TS_FENCE, 'doc.md', fencesOnConfigPath);

      expect(output).toBe('```ts\nconst x = { a: 1, b: 2 };\n```\n');
    });

    it('leaves a shell script formatted, which the carve-out must not reach', async () => {
      await expect(formatResolved('echo   a>out.txt\n', 'thing.sh')).resolves.toBe('echo a >out.txt\n');
    });

    it('leaves a Dockerfile formatted', async () => {
      await expect(formatResolved('FROM node:24-alpine   AS base\n', 'Dockerfile')).resolves.toBe(
        'FROM node:24-alpine AS base\n',
      );
    });
  });

  describe('option seams', () => {
    it('spreads a scalar option over the defaults', () => {
      expect(definePrettierConfig({ singleQuote: false }).singleQuote).toBe(false);
      expect(definePrettierConfig().singleQuote).toBe(true);
    });

    it('carries the house options through untouched', () => {
      const config = definePrettierConfig();

      expect(config.checkIgnorePragma).toBe(true);
      expect(config.trailingComma).toBe('all');
    });

    it('appends to the overrides rather than replacing them', () => {
      const extra = { files: ['*.md'], options: { proseWrap: 'always' as const } };
      const config = definePrettierConfig({ additionalOverrides: [extra] });

      expect(config.overrides).toHaveLength(3);
      expect(config.overrides?.at(-1)).toStrictEqual(extra);
    });

    it('appends to the plugins rather than replacing them', () => {
      const extra = { languages: [] };
      const config = definePrettierConfig({ additionalPlugins: [extra] });

      expect(config.plugins).toHaveLength(2);
      expect(config.plugins?.at(-1)).toBe(extra);
    });

    it('rejects a caller that tries to replace the overrides', () => {
      // @ts-expect-error - `overrides` is owned by the config; `additionalOverrides` is the seam
      expect(() => definePrettierConfig({ overrides: [] })).toThrow(/additionalOverrides/);
    });

    it('rejects a caller that tries to replace the plugins', () => {
      // @ts-expect-error - `plugins` is owned by the config; `additionalPlugins` is the seam
      expect(() => definePrettierConfig({ plugins: [] })).toThrow(/additionalPlugins/);
    });
  });
});

// region | Helpers

/** Formats `source` under the options resolved for `relativePath`. The path is matched, not read, so nothing backs it. */
async function formatResolved(source: string, relativePath: string, configPath = fixtureConfigPath): Promise<string> {
  const options = await resolveConfig(path.join(fixturesDir, relativePath), { config: configPath });

  return format(source, { ...options, filepath: relativePath });
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

/** Drops `overrides`, which Prettier resolves from a config file rather than honouring in `format`. */
function toFormatOptions(config: Config, filepath: string): Config & { filepath: string } {
  const { overrides: _overrides, ...flat } = config;

  return { ...flat, filepath };
}

// region | Helpers
