import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodePackedTarball } from '../tarball.ts';

/**
 * The synthesized layouts here are the ones npm and pnpm were observed to emit, down to the placeholder
 * `PaxHeader` entry name. Keep them faithful to a real packer rather than to the tar spec's full generality:
 * an idealized fixture would pass against a reader that no real tarball survives.
 */

const BLOCK_SIZE = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK_SIZE);

describe(decodePackedTarball, () => {
  it('reads the manifest and the file list', () => {
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{"name":"p","version":"1.0.0"}' }),
      entry({ name: 'package/dist/index.js', data: 'export const value = 1;\n' }),
    ]);

    const { files, packageJson } = decodePackedTarball(tarball, 'test.tgz');

    expect(packageJson.name).toBe('p');
    expect(files).toStrictEqual(['package.json', 'dist/index.js']);
  });

  it('rejoins a path split across the prefix and name fields', () => {
    // tar splits an over-long path at a `/`, and only the two fields together name the file.
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ prefix: 'package/dist', name: 'esm/index.d.ts', data: 'export declare const value: number;\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toContain('dist/esm/index.d.ts');
  });

  it('recovers a displaced path from its PAX extended header', () => {
    // The file entry's own name is the placeholder `PaxHeader`; only the PAX payload carries the real path.
    const realPath = `package/dist/${'x'.repeat(120)}.d.ts`;
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ name: 'PaxHeader', typeFlag: 'x', data: paxRecord('path', realPath) }),
      entry({ name: 'PaxHeader', data: 'export declare const value: number;\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toContain(realPath.slice('package/'.length));
    expect(files).not.toContain('PaxHeader');
  });

  it('applies a PAX path override to the next entry only', () => {
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ name: 'PaxHeader', typeFlag: 'x', data: paxRecord('path', 'package/dist/displaced.d.ts') }),
      entry({ name: 'PaxHeader', data: 'displaced\n' }),
      entry({ name: 'package/dist/plain.js', data: 'plain\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toStrictEqual(['package.json', 'dist/displaced.d.ts', 'dist/plain.js']);
  });

  it('ignores a PAX header that carries no path record', () => {
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ name: 'PaxHeader', typeFlag: 'x', data: paxRecord('mtime', '1700000000') }),
      entry({ name: 'package/dist/index.d.ts', data: 'export declare const value: number;\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toContain('dist/index.d.ts');
  });

  it('skips a global PAX header without consuming the next entry name', () => {
    const tarball = tarballOf([
      entry({ name: 'PaxHeader', typeFlag: 'g', data: paxRecord('comment', 'global') }),
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ name: 'package/dist/index.d.ts', data: 'export declare const value: number;\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toStrictEqual(['package.json', 'dist/index.d.ts']);
  });

  it('skips entries that are not regular files', () => {
    const tarball = tarballOf([
      entry({ name: 'package/dist/', typeFlag: '5' }),
      entry({ name: 'package/package.json', data: '{}' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toStrictEqual(['package.json']);
  });

  it('ignores entries outside the package root', () => {
    const tarball = tarballOf([
      entry({ name: 'package/package.json', data: '{}' }),
      entry({ name: 'elsewhere/stray.d.ts', data: 'stray\n' }),
    ]);

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toStrictEqual(['package.json']);
  });

  it('stops at the end-of-archive marker rather than reading past it', () => {
    const tarball = gzipSync(
      Buffer.concat([
        entry({ name: 'package/package.json', data: '{}' }),
        ZERO_BLOCK,
        ZERO_BLOCK,
        entry({ name: 'package/dist/after-the-end.d.ts', data: 'unreachable\n' }),
      ]),
    );

    const { files } = decodePackedTarball(tarball, 'test.tgz');

    expect(files).toStrictEqual(['package.json']);
  });

  it('throws for an archive that is not gzipped', () => {
    expect(() => decodePackedTarball(Buffer.from('not a gzip stream'), 'test.tgz')).toThrow(/Could not read tarball/);
  });

  it('throws for a tarball carrying no manifest', () => {
    const tarball = tarballOf([entry({ name: 'package/dist/index.js', data: 'export const value = 1;\n' })]);

    expect(() => decodePackedTarball(tarball, 'test.tgz')).toThrow(/contains no package.json/);
  });
});

// region | Helpers

/** Serializes a PAX record, whose length prefix counts the whole `"{length} {key}={value}\n"` line. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  if (String(length).length !== String(length + 1).length) length += 1;
  return `${length}${body}`;
}

/** Builds one tar entry: a 512-byte header followed by its data, padded out to a block boundary. */
function entry(fields: { name: string; prefix?: string; typeFlag?: string; data?: string }): Buffer {
  const { name, prefix = '', typeFlag = '0', data = '' } = fields;
  const body = Buffer.from(data, 'utf8');

  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8'); // mode
  header.write(octal(body.length, 12), 124, 12, 'utf8');
  header.write(octal(0, 12), 136, 12, 'utf8'); // mtime
  header.write(' '.repeat(8), 148, 8, 'utf8'); // checksum, summed as spaces
  header.write(typeFlag, 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  header.write(prefix, 345, 155, 'utf8');

  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${octal(checksum, 7)} `, 148, 8, 'utf8');

  const padding = Buffer.alloc((BLOCK_SIZE - (body.length % BLOCK_SIZE)) % BLOCK_SIZE);
  return Buffer.concat([header, body, padding]);
}

/** Encodes a numeric header field as the NUL-terminated octal text tar stores it as. */
function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** Gzips a sequence of entries, closing the archive with the two zero blocks that mark its end. */
function tarballOf(entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, ZERO_BLOCK, ZERO_BLOCK]));
}

// endregion | Helpers
