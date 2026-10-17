import { createHash } from 'node:crypto';

/** The hash functions that git uses for object ids, by the name that `git rev-parse --show-object-format` prints. */
export type GitObjectFormat = 'sha1' | 'sha256';

/**
 * One entry of a tree object. `name` holds the entry's name as bytes, one character per byte (`latin1`), so that a
 * name that is not valid UTF-8 survives a round trip and comparing two names compares their bytes.
 */
export interface GitTreeEntry {
  id: Buffer;
  mode: string;
  name: string;
}

/** The mode that a tree object records for a subtree. */
export const TREE_MODE = '40000';

/** Returns the raw id of a git object: the hash of `"<type> <byte length>\0"` followed by the content. */
export function hashGitObject(format: GitObjectFormat, type: 'blob' | 'tree', content: Buffer): Buffer {
  return createHash(format).update(`${type} ${content.length}\0`).update(content).digest();
}

/** Returns `value` as a `GitObjectFormat`, or `undefined` when git reported a format that this module cannot hash. */
export function parseObjectFormat(value: string): GitObjectFormat | undefined {
  return value === 'sha1' || value === 'sha256' ? value : undefined;
}

/** Splits a tree object's content into its entries, or returns `undefined` when the content is malformed. */
export function parseTreeObject(format: GitObjectFormat, content: Buffer): GitTreeEntry[] | undefined {
  const idLength = format === 'sha1' ? 20 : 32;
  const entries: GitTreeEntry[] = [];

  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    const nul = content.indexOf(0, space + 1);
    if (space === -1 || nul === -1 || nul + 1 + idLength > content.length) {
      return undefined;
    }
    entries.push({
      id: content.subarray(nul + 1, nul + 1 + idLength),
      mode: content.toString('latin1', offset, space),
      name: content.toString('latin1', space + 1, nul),
    });
    offset = nul + 1 + idLength;
  }

  return entries;
}

/**
 * Serializes entries into a tree object's content in git's canonical order: by name bytes, with a subtree's name
 * compared as though it ended in `/`.
 */
export function serializeTreeObject(entries: Iterable<GitTreeEntry>): Buffer {
  const sorted = [...entries].toSorted((left, right) => compareStrings(sortKeyOf(left), sortKeyOf(right)));
  return Buffer.concat(sorted.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`, 'latin1'), entry.id]));
}

// region | Helpers

/** Compares two strings by UTF-16 code unit, which for `latin1` strings is a comparison of their bytes. */
function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Returns the name by which git orders an entry within its tree. */
function sortKeyOf(entry: GitTreeEntry): string {
  return entry.mode === TREE_MODE ? `${entry.name}/` : entry.name;
}

// endregion | Helpers
