import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { readPackedTarball } from '../tarball.ts';

/**
 * tar splits an over-long path across its `prefix` and `name` header fields, but only at a `/`. These two
 * fixtures take the two branches that fall out of that: a deep path, which splits, and an over-long
 * filename, which cannot and so forces a PAX extended header instead. Both encodings hide the real path
 * from a naive reader — and a hidden `.d.ts` reads as a missing declaration, failing a healthy package.
 */
const DEEP_DIR = 'dist/esm/commands/subcommands/generated/deeply/nested/directory/segments/split-across-prefix';
const DEEP_TYPES_PATH = `${DEEP_DIR}/index.d.ts`;
const LONG_BASENAME = `index-${'x'.repeat(110)}.d.ts`;
const LONG_BASENAME_PATH = `dist/${LONG_BASENAME}`;

describe(readPackedTarball, () => {
  let tarballPath: string;
  let dir: string;

  // One pack for the whole suite: `pnpm pack` runs lifecycle scripts and dwarfs the assertions.
  beforeAll(() => {
    expect(`package/${DEEP_TYPES_PATH}`.length).toBeGreaterThan(100);
    expect(LONG_BASENAME.length).toBeGreaterThan(100);

    dir = mkdtempSync(path.join(tmpdir(), 'nmr-tarball-'));
    mkdirSync(path.join(dir, DEEP_DIR), { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'tarball-fixture',
        version: '1.0.0',
        type: 'module',
        files: ['dist'],
        exports: { '.': { types: `./${DEEP_TYPES_PATH}`, default: `./${DEEP_DIR}/index.js` } },
      }),
    );
    writeFileSync(path.join(dir, DEEP_DIR, 'index.js'), 'export const value = 1;\n');
    writeFileSync(path.join(dir, DEEP_DIR, 'index.d.ts'), 'export declare const value: number;\n');
    writeFileSync(path.join(dir, LONG_BASENAME_PATH), 'export declare const other: number;\n');

    const pack = spawnSync('pnpm', ['pack', '--pack-destination', dir], { cwd: dir, encoding: 'utf8' });
    expect(pack.status, pack.stderr).toBe(0);

    const tarball = readdirSync(dir).find((file) => file.endsWith('.tgz'));
    if (tarball === undefined) throw new Error('pnpm pack produced no tarball');
    tarballPath = path.join(dir, tarball);

    return () => rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('reads the manifest from the tarball', () => {
    const { packageJson } = readPackedTarball(tarballPath);

    expect(packageJson.name).toBe('tarball-fixture');
    expect(packageJson.version).toBe('1.0.0');
  });

  it('lists shipped files relative to the package root', () => {
    const { files } = readPackedTarball(tarballPath);

    expect(files).toContain('package.json');
    expect(files).toContain(`${DEEP_DIR}/index.js`);
  });

  it('rejoins a deep path split across the tar prefix and name fields', () => {
    const { files } = readPackedTarball(tarballPath);

    expect(files).toContain(DEEP_TYPES_PATH);
  });

  it('recovers a filename too long to split, from its PAX extended header', () => {
    // The packer writes this entry's ustar name as the placeholder `PaxHeader`; only the PAX payload
    // carries the real path.
    const { files } = readPackedTarball(tarballPath);

    expect(files).toContain(LONG_BASENAME_PATH);
    expect(files).not.toContain('PaxHeader');
  });

  it('throws for an archive that is not gzipped', () => {
    const notGzipped = path.join(dir, 'plain.tgz');
    writeFileSync(notGzipped, 'not a gzip stream');

    expect(() => readPackedTarball(notGzipped)).toThrow(/Could not read tarball/);
  });

  it('throws for a tarball carrying no manifest', () => {
    const manifestless = mkdtempSync(path.join(tmpdir(), 'nmr-tarball-empty-'));
    try {
      writeFileSync(path.join(manifestless, 'stray.txt'), 'no package.json here\n');
      const tar = spawnSync('tar', ['-czf', path.join(dir, 'manifestless.tgz'), '-C', manifestless, 'stray.txt'], {
        encoding: 'utf8',
      });
      expect(tar.status, tar.stderr).toBe(0);

      expect(() => readPackedTarball(path.join(dir, 'manifestless.tgz'))).toThrow(/contains no package.json/);
    } finally {
      rmSync(manifestless, { recursive: true, force: true });
    }
  });
});
