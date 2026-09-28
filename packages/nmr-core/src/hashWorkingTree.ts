import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { GIT_OUTPUT_LIMIT } from './gitOutputLimit.ts';
import { hasErrnoCode } from './hasErrnoCode.ts';

/**
 * A whole-repo content hash, or the reason one could not be produced. For every degraded condition (no repository,
 * no commit, a git failure, a tree that this hash cannot describe), the result is `ok: false` rather than a hash on
 * which a caller might act.
 */
export type WorkingTreeHashResult =
  { ok: true; hash: string; headSha: string; toplevel: string } | { ok: false; reason: string };

/**
 * Names the fold that this hash performs. Bump it whenever the fold changes, so that entries recorded under an older
 * fold cannot be mistaken for entries describing the same tree.
 */
const HASH_FORMAT = 'nmr-working-tree-v1';

/**
 * The count of space-separated fields that precede the path in each `--porcelain=v2` record type. A type absent
 * from this map is one that the parser does not recognize, which fails closed.
 */
const PRECEDING_FIELD_COUNTS: Record<string, number | undefined> = {
  1: 8,
  2: 9,
  '?': 1,
  u: 10,
};

/** The record types that report, in their third field, whether the path that they name is a submodule. */
const SUBMODULE_BEARING_TYPES = new Set(['1', '2', 'u']);

/**
 * Produces a content hash of the entire working tree at `cwd`: the commit's tree object folded with the current
 * content of every path that git reports as changed or untracked. Two trees with the same content hash alike, so a
 * `touch` that does not change any bytes leaves the hash unchanged, while any edit, addition, or deletion moves it.
 *
 * Reading git's own status keeps the running time proportional to what has changed rather than to the size of the
 * repository, and applies git's ignore rules. Nothing here writes to the object database or the index: A hash is
 * an observation, and a repository must look exactly the same after taking one.
 *
 * Because the commit's tree object is the base of the fold, committing an already-hashed tree moves the hash
 * even though the content did not change. The reverse holds too, and usefully: A rebase or an amended message
 * that preserves content leaves the hash alone, as does checking out a branch whose tree is identical.
 */
export function hashWorkingTree(cwd: string): WorkingTreeHashResult {
  const toplevelResult = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevelResult.ok) {
    return { ok: false, reason: `not a git repository: ${toplevelResult.error}` };
  }
  const toplevel = toplevelResult.stdout.trim();
  if (toplevel === '') {
    return { ok: false, reason: 'git did not report a repository toplevel' };
  }

  // A submodule's content is in a repository into which this hash never looks, so a tree containing one is a tree
  // that this hash cannot describe.
  if (existsSync(path.join(toplevel, '.gitmodules'))) {
    return { ok: false, reason: 'the repository declares submodules, whose content this hash does not cover' };
  }

  const revisionResult = runGit(['rev-parse', 'HEAD', 'HEAD^{tree}'], cwd);
  if (!revisionResult.ok) {
    return { ok: false, reason: `no commit at HEAD: ${revisionResult.error}` };
  }
  const [headSha, headTreeSha] = revisionResult.stdout.trim().split('\n', 2);
  if (headSha === undefined || headTreeSha === undefined) {
    return { ok: false, reason: 'git did not report a HEAD commit and tree' };
  }

  // `--untracked-files=all` lists untracked files individually; the default collapses a directory to one entry,
  // whose contents would then go unhashed.
  const statusResult = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], cwd);
  if (!statusResult.ok) {
    return { ok: false, reason: `git status failed: ${statusResult.error}` };
  }

  const pathsResult = collectChangedPaths(statusResult.stdout);
  if (!pathsResult.ok) {
    return pathsResult;
  }

  const hash = createHash('sha256');
  hash.update(HASH_FORMAT);
  hash.update('\0');
  hash.update(headTreeSha);
  hash.update('\0');

  // Sort so that the fold is order-invariant: Git's status order is not part of what the hash describes.
  for (const relativePath of [...pathsResult.paths].toSorted()) {
    const content = digestPathContent(toplevel, relativePath);
    if (!content.ok) {
      return content;
    }
    hash.update(relativePath);
    hash.update('\0');
    hash.update(content.kind);
    hash.update('\0');
    hash.update(content.digest);
    hash.update('\0');
  }

  return { ok: true, hash: hash.digest('hex'), headSha, toplevel };
}

/**
 * Returns the commit that `HEAD` names, or `undefined` when git cannot say. Because it is cheap next to a full
 * hash, a caller that has observed a tree can check whether `HEAD` still names the same commit without hashing the
 * tree again.
 */
export function readHeadSha(cwd: string): string | undefined {
  const result = runGit(['rev-parse', 'HEAD'], cwd);
  if (!result.ok) {
    return undefined;
  }

  const headSha = result.stdout.trim();
  return headSha === '' ? undefined : headSha;
}

// region | Helpers

/** What a changed path turned out to be on disk, folded in alongside its digest so a swap of kinds registers. */
type PathKind = 'absent' | 'file' | 'link';

type ChangedPathsResult = { ok: true; paths: Set<string> } | { ok: false; reason: string };

type PathContentResult = { ok: true; kind: PathKind; digest: string } | { ok: false; reason: string };

/**
 * Extracts every path named by a `--porcelain=v2 -z` status. An unrecognized record type fails closed: A record
 * that this parser cannot read may name a path whose content would then go unhashed, which is the one failure that
 * a content hash may never have.
 *
 * Record shapes, each a NUL-terminated field: an ordinary change (`1`) and an unmerged path (`u`) have their
 * path last, after a fixed count of space-separated fields; a rename or copy (`2`) has its new path last and
 * its original path in the field that follows; an untracked path (`?`) has its path alone.
 */
function collectChangedPaths(statusOutput: string): ChangedPathsResult {
  const records = statusOutput.split('\0');
  const paths = new Set<string>();

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record === '') {
      continue;
    }

    const type = record.slice(0, 1);
    if (type === '#') {
      continue;
    }

    // A submodule reports its state in the third field; this check catches one that `.gitmodules` does not declare.
    if (SUBMODULE_BEARING_TYPES.has(type) && extractField(record, 2)?.startsWith('S') === true) {
      return { ok: false, reason: 'the working tree contains a submodule, whose content this hash does not cover' };
    }

    const precedingFieldCount = PRECEDING_FIELD_COUNTS[type];
    if (precedingFieldCount === undefined) {
      return { ok: false, reason: `unrecognized git status record: ${JSON.stringify(record.slice(0, 40))}` };
    }

    const changedPath = extractPath(record, precedingFieldCount);
    if (changedPath === undefined) {
      return { ok: false, reason: `malformed git status record: ${JSON.stringify(record.slice(0, 40))}` };
    }
    paths.add(changedPath);

    if (type === '2') {
      // The original path of a rename is the next field, and no longer exists on disk; folding it in is what
      // separates a rename from a bare addition.
      index++;
      const originalPath = records[index];
      if (originalPath === undefined || originalPath === '') {
        return { ok: false, reason: 'git status reported a rename without an original path' };
      }
      paths.add(originalPath);
    }
  }

  return { ok: true, paths };
}

/** Returns the hex SHA-256 digest of a buffer. */
function digestBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Digests one changed path's current content. A path that git named but that is no longer on disk folds as
 * absent, which is what makes a deletion move the hash. A path that exists but cannot be read, or that is neither
 * a file nor a symlink, fails closed: A partial hash would certify content that it did not examine.
 */
function digestPathContent(toplevel: string, relativePath: string): PathContentResult {
  const absolutePath = path.join(toplevel, relativePath);

  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return { ok: true, kind: 'absent', digest: '' };
    }
    return { ok: false, reason: `could not stat ${relativePath}: ${describeError(error)}` };
  }

  try {
    if (stats.isSymbolicLink()) {
      // A symlink's content is the path that it names, which is also what git tracks for it.
      return { ok: true, kind: 'link', digest: digestBuffer(Buffer.from(readlinkSync(absolutePath))) };
    }
    if (stats.isFile()) {
      return { ok: true, kind: 'file', digest: digestBuffer(readFileSync(absolutePath)) };
    }
  } catch (error: unknown) {
    return { ok: false, reason: `could not read ${relativePath}: ${describeError(error)}` };
  }

  // A directory here is an untracked repository, which git reports as a single entry and does not look inside.
  return { ok: false, reason: `${relativePath} is neither a file nor a symlink, so its content is not hashable` };
}

/** Returns the space-separated field at `fieldIndex`, or `undefined` when the record does not have that field. */
function extractField(record: string, fieldIndex: number): string | undefined {
  return record.split(' ')[fieldIndex];
}

/**
 * Returns a record's trailing path: everything past the first `precedingFieldCount` space-separated fields.
 * Taking the remainder rather than a field keeps paths containing spaces intact.
 */
function extractPath(record: string, precedingFieldCount: number): string | undefined {
  let index = 0;
  for (let field = 0; field < precedingFieldCount; field++) {
    const separator = record.indexOf(' ', index);
    if (separator === -1) {
      return undefined;
    }
    index = separator + 1;
  }

  const extracted = record.slice(index);
  return extracted === '' ? undefined : extracted;
}

/**
 * Runs git and returns its stdout, or the reason it failed. A failure must never read as an empty status: An
 * unreported change would leave the hash certifying content that is no longer there.
 *
 * Invokes git without a shell, so a shell never interprets any part of a path or revision.
 */
function runGit(args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; error: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return { ok: false, error: stderr || `\`git ${args.join(' ')}\` failed with exit code ${result.status}.` };
  }

  return { ok: true, stdout: result.stdout };
}

// endregion | Helpers
