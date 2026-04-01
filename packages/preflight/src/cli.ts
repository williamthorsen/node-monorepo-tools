import process from 'node:process';

import { loadPreflightCollection } from './config.ts';
import { discoverInternalCollections } from './discoverInternalCollections.ts';
import { formatCombinedSummary } from './formatCombinedSummary.ts';
import { formatJsonError } from './formatJsonError.ts';
import { formatJsonReport } from './formatJsonReport.ts';
import { loadRemoteCollection, type LoadRemoteCollectionOptions } from './loadRemoteCollection.ts';
import { reportPreflight } from './reportPreflight.ts';
import { resolveGitHubToken } from './resolveGitHubToken.ts';
import { runPreflight } from './runPreflight.ts';
import type {
  ChecklistSummary,
  FixLocation,
  PreflightChecklist,
  PreflightCollection,
  PreflightReport,
  PreflightStagedChecklist,
} from './types.ts';

/** Discriminated union describing how to locate the preflight collection. */
export type CollectionSource =
  | { type: 'local'; path?: string }
  | { type: 'github'; repo: string; ref: string; collection: string }
  | { type: 'url'; url: string }
  | { type: 'internal' };

interface ParsedRunArgs {
  collectionSource: CollectionSource;
  configPath?: string;
  json: boolean;
  names: string[];
}

/** Extract a flag value from either `--flag value` or `--flag=value` form, advancing the index when needed. */
function extractFlagValue(
  flagName: string,
  arg: string,
  flags: string[],
  index: number,
  errorHint: string,
): { value: string; nextIndex: number } {
  const eqPrefix = `${flagName}=`;
  if (arg.startsWith(eqPrefix)) {
    const value = arg.slice(eqPrefix.length);
    if (value === '') {
      throw new Error(`${flagName} requires ${errorHint}`);
    }
    return { value, nextIndex: index };
  }
  const next = flags[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`${flagName} requires ${errorHint}`);
  }
  return { value: next, nextIndex: index + 1 };
}

/** Throw if a collection source flag has already been set. */
function assertNoExistingSource(existing: string | undefined): void {
  if (existing !== undefined) {
    throw new Error('Cannot combine --file, --github, and --url flags');
  }
}

/**
 * Parse `org/repo[@ref]` into repo and ref components.
 *
 * The `@ref` part is optional; defaults to `main`.
 */
function parseGitHubArg(value: string): { repo: string; ref: string } {
  const atIndex = value.lastIndexOf('@');
  if (atIndex === -1) {
    return { repo: value, ref: 'main' };
  }
  const repo = value.slice(0, atIndex);
  const ref = value.slice(atIndex + 1);
  if (ref === '') {
    throw new Error(`Invalid --github value: ref after '@' must not be empty in "${value}"`);
  }
  return { repo, ref };
}

/** Parse run-subcommand flags into a structured object. */
export function parseRunArgs(flags: string[]): ParsedRunArgs {
  const names: string[] = [];
  let sourceType: string | undefined;
  let filePath: string | undefined;
  let githubValue: string | undefined;
  let urlValue: string | undefined;
  let collectionName: string | undefined;
  let configPath: string | undefined;
  let json = false;

  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i] ?? '';

    if (arg === '--json') {
      json = true;
    } else if (arg === '--config' || arg === '-c' || arg.startsWith('--config=')) {
      const { value, nextIndex } = extractFlagValue('--config', arg, flags, i, 'a path argument');
      i = nextIndex;
      configPath = value;
    } else if (arg === '--file' || arg.startsWith('--file=')) {
      assertNoExistingSource(sourceType);
      const { value, nextIndex } = extractFlagValue('--file', arg, flags, i, 'a path argument');
      i = nextIndex;
      sourceType = 'file';
      filePath = value;
    } else if (arg === '--github' || arg.startsWith('--github=')) {
      assertNoExistingSource(sourceType);
      const { value, nextIndex } = extractFlagValue(
        '--github',
        arg,
        flags,
        i,
        'a repository argument (org/repo[@ref])',
      );
      i = nextIndex;
      sourceType = 'github';
      githubValue = value;
    } else if (arg === '--url' || arg.startsWith('--url=')) {
      assertNoExistingSource(sourceType);
      const { value, nextIndex } = extractFlagValue('--url', arg, flags, i, 'a URL argument');
      i = nextIndex;
      sourceType = 'url';
      urlValue = value;
    } else if (arg === '--collection' || arg.startsWith('--collection=')) {
      const { value, nextIndex } = extractFlagValue('--collection', arg, flags, i, 'a collection name');
      i = nextIndex;
      collectionName = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag '${arg}'`);
    } else {
      names.push(arg);
    }
  }

  // Post-loop validation for --github / --collection mutual dependency
  if (sourceType === 'github' && collectionName === undefined) {
    throw new Error('--github requires --collection');
  }
  if (collectionName !== undefined && sourceType !== 'github') {
    throw new Error('--collection requires --github');
  }

  let collectionSource: CollectionSource;
  if (sourceType === 'file') {
    collectionSource = { type: 'local', path: filePath };
  } else if (sourceType === 'github' && githubValue !== undefined && collectionName !== undefined) {
    const { repo, ref } = parseGitHubArg(githubValue);
    collectionSource = { type: 'github', repo, ref, collection: collectionName };
  } else if (sourceType === 'url' && urlValue !== undefined) {
    collectionSource = { type: 'url', url: urlValue };
  } else {
    collectionSource = { type: 'internal' };
  }

  return { collectionSource, configPath, json, names };
}

/** Resolve the effective fixLocation for a checklist, falling back to the collection-level default. */
function resolveFixLocation(
  checklist: PreflightChecklist | PreflightStagedChecklist,
  collectionDefault?: FixLocation,
): FixLocation {
  return checklist.fixLocation ?? collectionDefault ?? 'END';
}

/** Build a checklist summary from a report and its checklist name. */
function summarizeReport(name: string, report: PreflightReport): ChecklistSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of report.results) {
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }
  return { name, passed, failed, skipped, allPassed: report.passed, durationMs: report.durationMs };
}

interface RunCommandOptions {
  names: string[];
  collectionSource: CollectionSource;
  configPath?: string;
  json: boolean;
}

/** Build the GitHub raw content URL for a collection. */
function buildGitHubCollectionUrl(repo: string, ref: string, collection: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/.preflight/collections/${collection}.js`;
}

/** The default directory for internal collections. */
const INTERNAL_COLLECTIONS_DIR = '.config/preflight/collections';

/** Load a preflight collection from the appropriate source. */
async function loadCollection(source: CollectionSource): Promise<PreflightCollection> {
  switch (source.type) {
    case 'local':
      return loadPreflightCollection(source.path);
    case 'github': {
      const url = buildGitHubCollectionUrl(source.repo, source.ref, source.collection);
      const token = resolveGitHubToken();
      const options: LoadRemoteCollectionOptions = { url };
      if (token !== undefined) {
        options.token = token;
      }
      return loadRemoteCollection(options);
    }
    case 'url':
      return loadRemoteCollection({ url: source.url });
    case 'internal':
      // Internal mode is handled separately in runCommand
      throw new Error('Internal collection source should be handled by runCommand');
  }
}

/** Load and merge all internal collections from the default directory. */
async function loadInternalCollections(): Promise<PreflightCollection[]> {
  return discoverInternalCollections(INTERNAL_COLLECTIONS_DIR);
}

/** Run preflight checklists. Returns a numeric exit code. */
export async function runCommand({ names, collectionSource, json }: RunCommandOptions): Promise<number> {
  if (collectionSource.type === 'internal') {
    return runInternalCollections({ names, json });
  }

  let collection: PreflightCollection;
  try {
    collection = await loadCollection(collectionSource);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(formatJsonError(message) + '\n');
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }

  return runSingleCollection(collection, { names, json });
}

/** Run all internal collections from the default directory. */
async function runInternalCollections({ names, json }: { names: string[]; json: boolean }): Promise<number> {
  let collections: PreflightCollection[];
  try {
    collections = await loadInternalCollections();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(formatJsonError(message) + '\n');
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }

  let allPassed = true;
  for (const collection of collections) {
    const exitCode = await runSingleCollection(collection, { names, json });
    if (exitCode !== 0) {
      allPassed = false;
    }
  }
  return allPassed ? 0 : 1;
}

/** Run checklists from a single collection. */
async function runSingleCollection(
  collection: PreflightCollection,
  { names, json }: { names: string[]; json: boolean },
): Promise<number> {
  // Determine which checklists to run
  let checklists = collection.checklists;
  if (names.length > 0) {
    const availableNames = new Set(collection.checklists.map((c) => c.name));
    const unknownNames = names.filter((n) => !availableNames.has(n));
    if (unknownNames.length > 0) {
      const available = [...availableNames].join(', ');
      const message = `unknown checklist(s): ${unknownNames.join(', ')}. Available: ${available}`;
      if (json) {
        process.stdout.write(formatJsonError(message) + '\n');
      } else {
        process.stderr.write(`Error: ${message}\n`);
      }
      return 1;
    }
    const requestedNames = new Set(names);
    checklists = collection.checklists.filter((c) => requestedNames.has(c.name));
  }

  if (json) {
    return runJsonMode(checklists);
  }

  return runHumanMode(checklists, collection);
}

/** Run checklists and emit a single JSON object to stdout. */
async function runJsonMode(checklists: Array<PreflightChecklist | PreflightStagedChecklist>): Promise<number> {
  const entries: Array<{ name: string; report: PreflightReport }> = [];
  let allPassed = true;

  try {
    for (const checklist of checklists) {
      const report = await runPreflight(checklist);
      entries.push({ name: checklist.name, report });
      if (!report.passed) allPassed = false;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(formatJsonError(message) + '\n');
    return 1;
  }

  process.stdout.write(formatJsonReport(entries) + '\n');
  return allPassed ? 0 : 1;
}

/** Run checklists with human-readable output. */
async function runHumanMode(
  checklists: Array<PreflightChecklist | PreflightStagedChecklist>,
  collection: PreflightCollection,
): Promise<number> {
  const showHeader = checklists.length > 1;
  let allPassed = true;
  const summaries: ChecklistSummary[] = [];

  for (const checklist of checklists) {
    if (showHeader) {
      process.stdout.write(`\n--- ${checklist.name} ---\n\n`);
    }

    const report = await runPreflight(checklist);
    const fixLocation = resolveFixLocation(checklist, collection.fixLocation);
    const output = reportPreflight(report, { fixLocation });
    process.stdout.write(output + '\n');

    if (!report.passed) {
      allPassed = false;
    }

    if (showHeader) {
      summaries.push(summarizeReport(checklist.name, report));
    }
  }

  if (summaries.length > 1) {
    process.stdout.write('\n' + formatCombinedSummary(summaries) + '\n');
  }

  return allPassed ? 0 : 1;
}
