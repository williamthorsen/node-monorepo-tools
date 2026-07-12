import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { type PackageJson, parsePackageJson } from './package-json.ts';

/** Size of a tar header, and of the blocks file data is padded out to. */
const BLOCK_SIZE = 512;

/** Offsets and widths of the tar header fields this reader depends on. */
const NAME = { offset: 0, size: 100 };
const SIZE = { offset: 124, size: 12 };
const TYPE_FLAG = { offset: 156 };
const PREFIX = { offset: 345, size: 155 };

/** The directory every entry of an npm/pnpm tarball is nested under. */
const ROOT = 'package/';

export interface PackedTarball {
  /** Every regular file in the tarball, relative to the package root (the `package/` prefix removed). */
  files: string[];
  /** The package's manifest, as packed — so `publishConfig` rewrites applied at pack time are reflected. */
  packageJson: PackageJson;
}

/**
 * Reads a packed npm/pnpm tarball, returning its file list and its manifest. The tarball is what a
 * consumer actually installs, so it — not the source tree — is the authority on what the package ships
 * and what it claims.
 *
 * Throws when the archive cannot be decompressed or carries no manifest at its root.
 */
export function readPackedTarball(tarballPath: string): PackedTarball {
  return decodePackedTarball(readFileSync(tarballPath), tarballPath);
}

/** Decodes a gzipped tarball's bytes. `source` names the archive in error messages. */
export function decodePackedTarball(archive: Buffer, source: string): PackedTarball {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch (error) {
    throw new Error(`Could not read tarball ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const files: string[] = [];
  let manifest: string | undefined;

  // A PAX extended header (type `x`) carries the true path of the entry that follows it, whose own
  // header holds a truncated name. It applies to that one entry only.
  let paxPath: string | undefined;

  for (let offset = 0; offset + BLOCK_SIZE <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) break;

    const size = readOctal(header, SIZE);
    const typeFlag = String.fromCodePoint(header[TYPE_FLAG.offset] ?? 0);
    const dataOffset = offset + BLOCK_SIZE;
    const data = tar.subarray(dataOffset, dataOffset + size);
    offset = dataOffset + roundUpToBlock(size);

    if (typeFlag === 'x') {
      paxPath = readPaxPath(data.toString('utf8'));
      continue;
    }
    // A global header (`g`) applies to every following entry, but carries no per-entry path override.
    if (typeFlag === 'g') continue;

    const name = paxPath ?? readEntryName(header);
    paxPath = undefined;

    // Only regular files: `0` is the ustar spelling, and NUL the older one.
    if (typeFlag !== '0' && typeFlag !== '\0') continue;
    if (!name.startsWith(ROOT)) continue;

    const relativePath = name.slice(ROOT.length);
    files.push(relativePath);
    if (relativePath === 'package.json') manifest = data.toString('utf8');
  }

  if (manifest === undefined) {
    throw new Error(`Tarball ${source} contains no package.json`);
  }

  return { files, packageJson: parsePackageJson(manifest, source) };
}

/** Reports whether a header block is all zeroes, which is how a tar archive marks its end. */
function isZeroBlock(header: Buffer): boolean {
  return header.every((byte) => byte === 0);
}

/** Reads a NUL/space-terminated field as text. */
function readString(header: Buffer, field: { offset: number; size: number }): string {
  const raw = header.subarray(field.offset, field.offset + field.size);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/** Reads a numeric header field, which tar stores as NUL/space-padded octal text. */
function readOctal(header: Buffer, field: { offset: number; size: number }): number {
  const text = readString(header, field).trim();
  const value = Number.parseInt(text, 8);
  return Number.isNaN(value) ? 0 : value;
}

/** Joins a ustar header's `prefix` and `name`, which together encode paths too long for `name` alone. */
function readEntryName(header: Buffer): string {
  const name = readString(header, NAME);
  const prefix = readString(header, PREFIX);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * Extracts the `path` override from a PAX extended header's payload, a sequence of
 * `"{length} {key}={value}\n"` records. Returns undefined when the payload declares no path.
 */
function readPaxPath(payload: string): string | undefined {
  for (const record of payload.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** Rounds a file size up to the block boundary tar pads its data out to. */
function roundUpToBlock(size: number): number {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}
