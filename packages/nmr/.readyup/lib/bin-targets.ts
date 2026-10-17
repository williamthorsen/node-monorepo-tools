import { basename, posix } from 'node:path';

import type { CheckOutcome, RdyCheck } from 'readyup';
import { isRecord, listTrackedFiles, type Workspace } from 'readyup/check-utils';

import { discoverWorkspacesOrFailure, formatPaths, readFileIn } from './repo-files.ts';

/** The directory to which a build writes its output. A `bin` target names it only when it has skipped the wrapper. */
const BUILD_OUTPUT_DIR = 'dist';

/**
 * Matches the first relative specifier named by a bin wrapper, which is the build entry that it loads at runtime.
 *
 * One pattern reaches both shapes in use: `await import('../dist/esm/cli.js')`, and
 * `new URL('../dist/esm/cli.js', import.meta.url)` whose href the wrapper then imports.
 */
const WRAPPER_TARGET_PATTERN = /['"](\.\.?\/[^'"]+)['"]/;

/** One `bin` entry of a workspace package, with its target normalized to a package-relative path. */
interface BinEntry {
  readonly command: string;
  readonly target: string;
}

export const binTargetChecks: RdyCheck[] = [
  {
    name: 'every bin target is a committed wrapper',
    severity: 'error',
    check: () => everyBinTargetIsACommittedWrapper(),
    fix: `Point each listed entry at a committed wrapper under bin/ that loads the build output at runtime. pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, so a target that is not committed does not exist when pnpm tries to link it. pnpm never retries, which leaves the link missing for the life of the node_modules tree`,
  },
  {
    name: "every bin wrapper's build-output target is covered by files",
    severity: 'warn',
    check: () => everyBinWrapperTargetIsCoveredByFiles(),
    fix: 'Add the build output directory to `files` in each listed package. npm and pnpm publish the bin target itself whatever `files` says, so the wrapper is published pointing at build output missing from the tarball',
  },
];

/**
 * Checks that every workspace `bin` entry points at a committed wrapper rather than at build output.
 *
 * pnpm links a workspace package's bins during the install's link phase, which runs before anything is built, and
 * never retries: A target that is not committed is missing for the life of the `node_modules` tree, and deleting
 * that tree is the only repair. Private packages are in scope, because pnpm links their bins too.
 *
 * The second reason reads tracking rather than presence. A target under `dist/` is on disk in any built
 * checkout, so its absence is evidence only in a fresh clone, while git's ignorance of it holds either way.
 *
 * @internal - Exported only to enable testing
 */
export async function everyBinTargetIsACommittedWrapper(): Promise<boolean | CheckOutcome> {
  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const trackedFiles = await listTrackedFiles();
  const trackedPaths = trackedFiles === undefined ? undefined : new Set(trackedFiles);

  const offenders = workspaceDiscovery.workspaces.flatMap((workspace) =>
    readBinEntries(workspace).flatMap((entry) => {
      const defect = describeBinTargetDefect(workspace, entry, trackedPaths);
      return defect === undefined ? [] : `${describeBinEntry(workspace, entry)} (${defect})`;
    }),
  );

  if (offenders.length === 0) return true;
  return { ok: false, detail: formatPaths(offenders) };
}

/**
 * Checks that `files` covers the build output that each bin wrapper loads at runtime.
 *
 * npm and pnpm publish every `bin` target whatever `files` says, so the wrapper is always published; `files` can
 * drop the build entry that the wrapper loads, which publishes a bin resolving to nothing. The force-include of
 * `main` covers that entry only in a package whose `main` names it.
 *
 * A package that does not declare `files` skips, as does a target under `dist/`, which is build output rather than
 * a wrapper and belongs to `everyBinTargetIsACommittedWrapper`. An unreadable file and one that does not name a
 * relative specifier skip too: The wrapper's shape is a convention rather than a contract.
 *
 * @internal - Exported only to enable testing
 */
export function everyBinWrapperTargetIsCoveredByFiles(): boolean | CheckOutcome {
  const workspaceDiscovery = discoverWorkspacesOrFailure((workspace) => !workspace.isRoot);
  if (!workspaceDiscovery.ok) return workspaceDiscovery;

  const cwd = process.cwd();
  const offenders = workspaceDiscovery.workspaces.flatMap((workspace) => {
    const files = workspace.packageJson['files'];
    if (!Array.isArray(files)) return [];

    const publishedSegments = new Set(
      files.flatMap((entry) => (typeof entry === 'string' ? readFirstSegment(entry) : [])),
    );

    return readBinEntries(workspace).flatMap((entry) => {
      const target = readWrapperTarget(cwd, workspace, entry);
      if (target === undefined || publishedSegments.has(readFirstSegment(target))) return [];
      return `${describeBinEntry(workspace, entry)} -> ${target}`;
    });
  });

  if (offenders.length === 0) return true;
  return { ok: false, detail: formatPaths(offenders) };
}

// region | Helpers

/** Renders one entry as `{package}:{command} -> {target}`, the form in which an offender is reported. */
function describeBinEntry(workspace: Workspace, entry: BinEntry): string {
  return `${workspace.name ?? workspace.dir}:${entry.command} -> ${entry.target}`;
}

/**
 * Names what is wrong with a `bin` target, or undefined when nothing is.
 *
 * A target under `dist/` reports under that reason alone, though it is untracked as well: The two share one fix,
 * and naming the directory points at the wrapper pattern. A tree outside a git repository does not yield a
 * listing, which skips the tracking reason rather than failing it.
 */
function describeBinTargetDefect(
  workspace: Workspace,
  entry: BinEntry,
  trackedPaths: ReadonlySet<string> | undefined,
): string | undefined {
  if (readFirstSegment(entry.target) === BUILD_OUTPUT_DIR) return `names a path under ${BUILD_OUTPUT_DIR}/`;
  if (trackedPaths === undefined) return undefined;
  return trackedPaths.has(`${workspace.dir}/${entry.target}`) ? undefined : 'untracked';
}

/** Strips a leading `./` from a `bin` target, so that the comparisons in this kit do not have to allow for it. */
function normalizeBinTarget(target: string): string {
  return target.replace(/^\.\//, '');
}

/**
 * Reads a workspace's `bin` field as entries, expanding npm's string form, which names the command after the
 * package. A leading `./` is stripped, so a target compares against `files` and the tracked listing alike.
 */
function readBinEntries(workspace: Workspace): BinEntry[] {
  const bin = workspace.packageJson['bin'];

  if (typeof bin === 'string') {
    const command = workspace.name?.split('/').at(-1) ?? basename(workspace.dir);
    return [{ command, target: normalizeBinTarget(bin) }];
  }

  if (!isRecord(bin)) return [];
  return Object.entries(bin).flatMap(([command, target]) =>
    typeof target === 'string' ? { command, target: normalizeBinTarget(target) } : [],
  );
}

/**
 * Reads the leading path segment of a `bin` target or a `files` entry.
 *
 * Comparing at this granularity accepts a `files` entry naming a subdirectory of the target. For example,
 * `files: ["dist/esm"]` passes a wrapper loading `../dist/cjs/cli.js`. The coarsening under-reports rather than
 * misreports.
 */
function readFirstSegment(entry: string): string {
  return normalizeBinTarget(entry).split('/', 1).at(0) ?? '';
}

/**
 * Resolves the build entry that a wrapper loads, as a package-relative path, or undefined when it does not name one.
 *
 * A target under `dist/` resolves to undefined: It is build output rather than a wrapper, and in a built
 * checkout reading it would match the compiled entry's own first relative import. A build directory under any
 * other name is still read as a wrapper, which is a limitation of identifying one by `dist/` alone.
 */
function readWrapperTarget(cwd: string, workspace: Workspace, entry: BinEntry): string | undefined {
  if (readFirstSegment(entry.target) === BUILD_OUTPUT_DIR) return undefined;

  const content = readFileIn(cwd, `${workspace.dir}/${entry.target}`);
  if (content === undefined) return undefined;

  const specifier = WRAPPER_TARGET_PATTERN.exec(content)?.[1];
  if (specifier === undefined) return undefined;

  return posix.normalize(posix.join(posix.dirname(entry.target), specifier));
}

// endregion | Helpers
