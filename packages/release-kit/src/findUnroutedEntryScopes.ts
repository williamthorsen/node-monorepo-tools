import { isNonChangeSubject } from './classifyChangelogCommit.ts';
import type { RawCommit } from './enumerateReleaseWindows.ts';
import { parseChangeRecordBlock } from './parseChangeRecordBlock.ts';
import type { UnroutedEntryScope } from './types.ts';

/** A workspace's `dir` with the commits of its unreleased window. */
export interface WorkspaceWindow {
  commits: readonly RawCommit[];
  dir: string;
}

/**
 * Finds the change-record entry scopes of the unreleased windows that route their entry to no workspace whose window
 * contains the commit, and returns the findings keyed by the `dir` of every workspace whose window contains it.
 *
 * A scope resolves through `scopeAliases` first. It is not reported when it resolves to `*`, to a workspace whose
 * window contains the commit, or to a `configuredDirs` workspace absent from `windows`, which the run did not read.
 * `root` is not reported unless a configured workspace has that `dir`, in which case it matches as that workspace.
 */
export function findUnroutedEntryScopes(
  windows: readonly WorkspaceWindow[],
  configuredDirs: readonly string[],
  scopeAliases: Readonly<Record<string, string>>,
): Map<string, UnroutedEntryScope[]> {
  const readDirs = new Set(windows.map((window) => window.dir));
  const unreadDirs = new Set(configuredDirs.filter((dir) => !readDirs.has(dir)));
  const isRootReserved = !configuredDirs.includes('root');

  const findings = new Map<string, UnroutedEntryScope[]>();
  for (const { commit, windowDirs } of indexCommits(windows).values()) {
    for (const finding of findCommitUnroutedScopes(commit, windowDirs, unreadDirs, isRootReserved, scopeAliases)) {
      for (const dir of windowDirs) {
        const list = findings.get(dir) ?? [];
        list.push(finding);
        findings.set(dir, list);
      }
    }
  }
  return findings;
}

// region | Helpers

/** Returns the unrouted scopes of one commit's block, in entry order; none for a commit that `readCommit` skips. */
function findCommitUnroutedScopes(
  commit: RawCommit,
  windowDirs: ReadonlySet<string>,
  unreadDirs: ReadonlySet<string>,
  isRootReserved: boolean,
  scopeAliases: Readonly<Record<string, string>>,
): UnroutedEntryScope[] {
  if (isNonChangeSubject(commit.subject)) {
    return [];
  }
  const reading = parseChangeRecordBlock(commit.message);
  if (reading.kind !== 'read') {
    return [];
  }

  const findings: UnroutedEntryScope[] = [];
  for (const [index, entry] of reading.entries.entries()) {
    const scopes = new Set(entry.scopes);
    for (const scope of scopes) {
      const resolved = scopeAliases[scope] ?? scope;
      const isRouted =
        resolved === '*' ||
        windowDirs.has(resolved) ||
        unreadDirs.has(resolved) ||
        (resolved === 'root' && isRootReserved);
      if (!isRouted) {
        findings.push({ commitHash: commit.hash, commitSubject: commit.subject, entryPosition: index + 1, scope });
      }
    }
  }
  return findings;
}

/** Maps each commit hash to the commit and the `dir` of every workspace whose window contains it. */
function indexCommits(
  windows: readonly WorkspaceWindow[],
): Map<string, { commit: RawCommit; windowDirs: Set<string> }> {
  const index = new Map<string, { commit: RawCommit; windowDirs: Set<string> }>();
  for (const window of windows) {
    for (const commit of window.commits) {
      const indexed = index.get(commit.hash);
      if (indexed === undefined) {
        index.set(commit.hash, { commit, windowDirs: new Set([window.dir]) });
      } else {
        indexed.windowDirs.add(window.dir);
      }
    }
  }
  return index;
}

// endregion | Helpers
