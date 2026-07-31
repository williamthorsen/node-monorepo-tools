import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from 'prettier';
import { format, getFileInfo, getSupportInfo } from 'prettier';
import { describe, expect, it } from 'vitest';

import { definePrettierConfig } from '../prettier.ts';

const fixturesDir = path.join(import.meta.dirname, 'fixtures');

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

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

/** Drops `overrides`, which Prettier resolves from a config file rather than honouring in `format`. */
function toFormatOptions(config: Config, filepath: string): Config & { filepath: string } {
  const { overrides: _overrides, ...flat } = config;

  return { ...flat, filepath };
}

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

      expect(config.overrides).toHaveLength(2);
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
