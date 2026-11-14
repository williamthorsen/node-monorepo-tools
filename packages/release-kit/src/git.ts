import { execFileSync } from 'node:child_process';

import { runGit } from '@williamthorsen/nmr-core';

/** A commit reachable from HEAD and the hashes of its parents. */
export interface AncestryEntry {
  hash: string;
  parents: string[];
}

/** The git operations that release-kit runs, each returning parsed output and throwing when git fails. */
export interface Git {
  /** Stages every change in the working tree. */
  addAll(): void;
  /** Creates a commit with `message`. */
  commit(message: string): void;
  /** Creates an annotated tag at HEAD whose message is its name. */
  createAnnotatedTag(tag: string): void;
  /** Reports whether a tracked file has staged or unstaged changes; untracked files do not count. */
  hasTrackedChanges(): boolean;
  /** Reports whether the working directory is inside a git work tree; never throws. */
  isInsideWorkTree(): boolean;
  /** Lists the tags whose names match `pattern`, every tag when it is absent. */
  listTags(pattern?: string): string[];
  /** Lists the tags that point at HEAD. */
  listTagsAtHead(): string[];
  /** Lists every tag with its creation date and the commit at which it points. */
  listTagRefs(): TagRef[];
  /** Pushes `branch` to `origin`, with git's output on the terminal. */
  pushBranch(branch: string): void;
  /** Pushes `tag` alone to `origin`, with git's output on the terminal. */
  pushTag(tag: string): void;
  /** Reads every commit reachable from HEAD in topological order, newest first; empty for an unborn HEAD. */
  readAncestry(): AncestryEntry[];
  /** Reads every commit reachable from HEAD that touches one of `paths`, or any path when it is absent, newest first. */
  readCommits(paths?: readonly string[]): RawCommit[];
  /** Returns the name of the checked-out branch. */
  readCurrentBranch(): string;
  /** Returns the `git status --porcelain` output without its trailing newline, empty when the tree is clean. */
  readStatus(): string;
}

/** A commit as git records it, before any parsing or filtering. */
export interface RawCommit {
  /** The full 40-character hash. */
  hash: string;
  /** The first line, with a wrapped subject folded onto one line by git. */
  subject: string;
  /** The message after its first blank line, empty when the commit does not have a body. */
  body: string;
  /** The raw commit message, subject and body together. */
  message: string;
}

/** The `Git` that runs git in the process's working directory. */
export const realGit: Git = {
  addAll: () => {
    readGitOutput(['add', '-A']);
  },
  commit: (message) => {
    readGitOutput(['commit', '-m', message]);
  },
  createAnnotatedTag: (tag) => {
    readGitOutput(['tag', '-a', tag, '-m', tag]);
  },
  hasTrackedChanges: () => readGitOutput(['status', '--porcelain', '--untracked-files=no']).trim().length > 0,
  isInsideWorkTree: () => runGit(['rev-parse', '--is-inside-work-tree'], process.cwd()).ok,
  listTags: (pattern) =>
    splitLines(readGitOutput(pattern === undefined ? ['tag', '--list'] : ['tag', '--list', pattern])),
  listTagsAtHead: () => splitLines(readGitOutput(['tag', '--points-at', 'HEAD'])),
  listTagRefs,
  pushBranch: (branch) => {
    pushWithTerminalOutput(['push', 'origin', branch]);
  },
  pushTag: (tag) => {
    pushWithTerminalOutput(['push', '--no-follow-tags', 'origin', tag]);
  },
  readAncestry,
  readCommits,
  readCurrentBranch: () => readGitOutput(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
  readStatus: () => readGitOutput(['status', '--porcelain']).trimEnd(),
};

/** A tag, the date on which it was created, and the commit at which it points. */
export interface TagRef {
  tag: string;
  /** Unix seconds: the tagger date for an annotated tag, the commit date for a lightweight one. */
  timestampSec: number;
  /** The commit at which the tag points, dereferenced for an annotated tag. */
  commitHash: string;
}

// region | Helpers

/**
 * Unit separator (U+001F) delimiting the fields of one git output record.
 *
 * Node.js v24+ rejects null bytes in child-process arguments, so this ASCII control character stands in. Git produces
 * neither control character in a commit message.
 */
const FIELD_SEPARATOR = '\u{1F}';

/** Record separator (U+001E) delimiting commit records, whose bodies contain newlines. */
const RECORD_SEPARATOR = '\u{1E}';

/**
 * Lists every tag with `for-each-ref`. An annotated tag names its commit in the dereferenced field; a lightweight tag
 * is the commit.
 */
function listTagRefs(): TagRef[] {
  const fields = ['%(refname:strip=2)', '%(creatordate:unix)', '%(objectname)', '%(*objectname)'];
  const output = readGitOutput(['for-each-ref', `--format=${fields.join('%1f')}`, 'refs/tags']).trim();

  const refs: TagRef[] = [];
  for (const line of output.split('\n')) {
    const [tag, creatorDate, objectName, dereferencedName] = line.split(FIELD_SEPARATOR);
    if (tag === undefined || tag === '' || creatorDate === undefined || objectName === undefined) {
      continue;
    }
    refs.push({ tag, timestampSec: Number(creatorDate), commitHash: dereferencedName || objectName });
  }
  return refs;
}

/** Splits one `git log` record into a commit, or returns undefined when the record is blank. */
function parseCommitRecord(record: string): RawCommit | undefined {
  // `--pretty=format:` joins records with a newline, which precedes every record but the first.
  const [hash, subject, message] = record.replace(/^\n+/, '').split(FIELD_SEPARATOR);
  if (hash === undefined || subject === undefined || message === undefined || hash === '') {
    return undefined;
  }
  const trimmedMessage = message.replace(/\s+$/, '');
  const bodyStart = trimmedMessage.indexOf('\n\n');
  const body = bodyStart === -1 ? '' : trimmedMessage.slice(bodyStart + 2);

  return { hash, subject, body, message: trimmedMessage };
}

/** Runs a `git push` whose output goes to the terminal, throwing when it fails. */
function pushWithTerminalOutput(args: readonly string[]): void {
  execFileSync('git', args, { stdio: 'inherit' });
}

/**
 * Reads the ancestry with `rev-list`. `--ignore-missing` makes an unborn HEAD yield an empty graph rather than the exit
 * code that git also uses outside a repository, so the empty-history case stays distinguishable from a failure.
 */
function readAncestry(): AncestryEntry[] {
  const output = readGitOutput(['rev-list', '--topo-order', '--parents', '--ignore-missing', 'HEAD']).trim();

  const entries: AncestryEntry[] = [];
  for (const line of output.split('\n')) {
    const [hash, ...parents] = line.split(' ');
    if (hash !== undefined && hash !== '') {
      entries.push({ hash, parents });
    }
  }
  return entries;
}

/** Reads commits with `git log`, which applies its default history simplification. */
function readCommits(paths?: readonly string[]): RawCommit[] {
  const format = `%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`;
  const args = ['log', 'HEAD', `--pretty=format:${format}`];
  if (paths !== undefined && paths.length > 0) {
    args.push('--', ...paths);
  }

  const commits: RawCommit[] = [];
  for (const record of readGitOutput(args).trim().split(RECORD_SEPARATOR)) {
    const commit = parseCommitRecord(record);
    if (commit !== undefined) {
      commits.push(commit);
    }
  }
  return commits;
}

/** Runs git in the process's working directory and returns its stdout, throwing git's error when it fails. */
function readGitOutput(args: readonly string[]): string {
  const result = runGit(args, process.cwd());
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.stdout;
}

/** Returns the trimmed, non-empty lines of `output`. */
function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// endregion | Helpers
