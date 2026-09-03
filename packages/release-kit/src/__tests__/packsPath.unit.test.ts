import { describe, expect, it } from 'vitest';

import { packsPath } from '../packsPath.ts';

const CHANGELOG = 'CHANGELOG.md';
const CHANGELOG_JSON = '.meta/changelog.json';

describe(packsPath, () => {
  describe('absent and malformed files values', () => {
    // npm packs everything but its ignore rules when no `files` field constrains the tarball.
    it('returns true when the field is undefined', () => {
      expect(packsPath(undefined, CHANGELOG)).toBe(true);
    });

    it.each([
      ['a string', 'dist'],
      ['null', null],
      ['an object', { dist: true }],
      ['an array holding a non-string', ['dist', 42]],
    ])('returns true for %s, which constrains nothing npm understands', (_label, filesField) => {
      expect(packsPath(filesField, CHANGELOG)).toBe(true);
    });

    // Verified against npm 11.17.0: an empty array packs only package.json, README, LICENSE, and the main and
    // bin targets, so it is a real constraint rather than an absent one.
    it('returns false for an empty array', () => {
      expect(packsPath([], CHANGELOG)).toBe(false);
    });
  });

  describe('literal entries', () => {
    it.each([
      ['a bare name', CHANGELOG],
      ['a ./-prefixed name', './CHANGELOG.md'],
      ['a /-prefixed name', '/CHANGELOG.md'],
    ])('matches %s', (_label, entry) => {
      expect(packsPath([entry], CHANGELOG)).toBe(true);
    });

    it('returns false when no entry names the file', () => {
      expect(packsPath(['dist', 'bin'], CHANGELOG)).toBe(false);
    });

    it('matches an exact nested path', () => {
      expect(packsPath([CHANGELOG_JSON], CHANGELOG_JSON)).toBe(true);
    });
  });

  // npm includes everything beneath a matched directory, so an entry naming an ancestor covers the file.
  describe('ancestor entries', () => {
    it.each([
      ['a bare directory', '.meta'],
      ['a trailing-slash directory', '.meta/'],
    ])('matches %s', (_label, entry) => {
      expect(packsPath([entry], CHANGELOG_JSON)).toBe(true);
    });

    it('matches a directory reached through a star, as `dist/*` ships `dist/esm/index.js`', () => {
      expect(packsPath(['dist/*'], 'dist/esm/index.js')).toBe(true);
    });

    it('returns false when the entry names a sibling directory', () => {
      expect(packsPath(['dist'], CHANGELOG_JSON)).toBe(false);
    });
  });

  describe('glob entries', () => {
    it.each([
      ['a trailing star', 'CHANGELOG*', CHANGELOG],
      ['an extension star', '*.md', CHANGELOG],
      ['a bare star', '*', CHANGELOG],
      ['a scoped extension star', '.meta/*.json', CHANGELOG_JSON],
      ['a directory star', '.meta/*', CHANGELOG_JSON],
      ['a directory globstar', '.meta/**', CHANGELOG_JSON],
      ['a leading globstar', '**/*.json', CHANGELOG_JSON],
      ['a question mark', 'CHANGELO?.md', CHANGELOG],
    ])('matches %s', (_label, entry, path) => {
      expect(packsPath([entry], path)).toBe(true);
    });

    // A leading globstar spans zero directories, so it reaches a file sitting at the package root.
    it('matches a root-level file through a leading globstar', () => {
      expect(packsPath(['**/*.json'], 'package-metadata.json')).toBe(true);
    });

    it('does not let a single star span a path separator', () => {
      expect(packsPath(['*.json'], CHANGELOG_JSON)).toBe(false);
    });

    it('treats a dot in the entry as a literal rather than a wildcard', () => {
      expect(packsPath(['CHANGELOG.md'], 'CHANGELOGxmd')).toBe(false);
    });
  });

  describe('negation entries', () => {
    it('does not count a negation entry toward inclusion', () => {
      expect(packsPath(['!CHANGELOG.md'], CHANGELOG)).toBe(false);
    });

    it('leaves a sibling entry that does include the file intact', () => {
      expect(packsPath(['CHANGELOG.md', '!dist/*.map'], CHANGELOG)).toBe(true);
    });
  });

  it('matches the files field release-kit itself declares against the changelog it ships', () => {
    const filesField = [
      '.readyup/kits/*.js',
      '.readyup/manifest.json',
      'bin',
      'dist/*',
      'cliff.toml.template',
      'presets/**',
      'schemas/**',
      'CHANGELOG.md',
    ];

    expect(packsPath(filesField, CHANGELOG)).toBe(true);
    expect(packsPath(filesField, CHANGELOG_JSON)).toBe(false);
  });
});
