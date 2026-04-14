import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import stringify from 'json-stringify-pretty-compact';

import { isChangelogEntry } from './changelogJsonUtils.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogSection, ReleaseConfig } from './types.ts';

/** Shape of a single commit in git-cliff's `--context` JSON output. */
interface CliffContextCommit {
  message: string;
  group?: string;
}

/** Shape of a single release in git-cliff's `--context` JSON output. */
interface CliffContextRelease {
  version?: string;
  timestamp?: number;
  commits?: CliffContextCommit[];
}

/**
 * Generate structured changelog JSON from git history using git-cliff `--context`.
 *
 * Transforms git-cliff's context output into `ChangelogEntry[]`, tags each section with an
 * audience based on `devOnlySections`, and writes the result to the configured output path.
 * Returns the output file path as a single-element array for consistency with `generateChangelog`.
 */
export function generateChangelogJson(
  config: Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'>,
  changelogPath: string,
  tag: string,
  dryRun: boolean,
  options?: GenerateChangelogOptions,
): string[] {
  const outputFile = join(changelogPath, config.changelogJson.outputPath);

  if (dryRun) {
    return [outputFile];
  }

  const resolvedConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);

  let cliffConfigPath = resolvedConfigPath;
  let tempDir: string | undefined;
  if (resolvedConfigPath.endsWith('.template')) {
    tempDir = mkdtempSync(join(tmpdir(), 'cliff-'));
    cliffConfigPath = join(tempDir, 'cliff.toml');
    copyFileSync(resolvedConfigPath, cliffConfigPath);
  }

  const args = ['--config', cliffConfigPath, '--context', '--tag', tag];

  if (options?.tagPattern !== undefined) {
    args.push('--tag-pattern', options.tagPattern);
  }

  for (const includePath of options?.includePaths ?? []) {
    args.push('--include-path', includePath);
  }

  try {
    const contextJson = execFileSync('npx', ['--yes', 'git-cliff', ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const releases = parseCliffContext(contextJson);
    const devOnlySections = new Set(config.changelogJson.devOnlySections);
    const entries = transformReleases(releases, devOnlySections);

    const existingEntries = readExistingEntries(outputFile);
    const merged = mergeEntries(entries, existingEntries);

    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, stringify(merged, { maxLength: 100 }) + '\n', 'utf8');

    return [outputFile];
  } catch (error: unknown) {
    throw new Error(
      `Failed to generate changelog JSON for ${outputFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Generate a synthetic changelog JSON entry for propagation-only bumps.
 *
 * Mirrors `writeSyntheticChangelog` but produces structured JSON instead of markdown.
 */
export function generateSyntheticChangelogJson(
  config: Pick<ReleaseConfig, 'changelogJson'>,
  changelogPath: string,
  newVersion: string,
  date: string,
  propagatedFrom: Array<{ packageName: string; newVersion: string }>,
  dryRun: boolean,
): string[] {
  const outputFile = join(changelogPath, config.changelogJson.outputPath);

  if (dryRun) {
    return [outputFile];
  }

  const items: ChangelogItem[] = propagatedFrom.map((dep) => ({
    description: `Bumped \`${dep.packageName}\` to ${dep.newVersion}`,
  }));

  const entry: ChangelogEntry = {
    version: newVersion,
    date,
    sections: [{ title: 'Dependency updates', audience: 'dev', items }],
  };

  const existingEntries = readExistingEntries(outputFile);
  const merged = mergeEntries([entry], existingEntries);

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, stringify(merged, { maxLength: 100 }) + '\n', 'utf8');

  return [outputFile];
}

/** Parse the JSON output from `git-cliff --context`. */
function parseCliffContext(json: string): CliffContextRelease[] {
  const parsed: unknown = JSON.parse(json);
  if (!isUnknownArray(parsed)) {
    throw new TypeError('Expected git-cliff --context output to be an array');
  }
  return parsed.map(toCliffContextRelease);
}

/** Narrow an unknown value to a `CliffContextRelease`, treating non-object entries as empty releases. */
function toCliffContextRelease(value: unknown): CliffContextRelease {
  if (!isRecord(value)) {
    return {};
  }
  const release: CliffContextRelease = {};
  if (typeof value.version === 'string') {
    release.version = value.version;
  }
  if (typeof value.timestamp === 'number') {
    release.timestamp = value.timestamp;
  }
  if (isUnknownArray(value.commits)) {
    release.commits = value.commits.map(toCliffContextCommit);
  }
  return release;
}

/** Narrow an unknown value to a `CliffContextCommit`. */
function toCliffContextCommit(value: unknown): CliffContextCommit {
  if (!isRecord(value)) {
    return { message: '' };
  }
  const commit: CliffContextCommit = {
    message: typeof value.message === 'string' ? value.message : '',
  };
  if (typeof value.group === 'string') {
    commit.group = value.group;
  }
  return commit;
}

/** Transform git-cliff context releases into `ChangelogEntry[]`. */
function transformReleases(releases: CliffContextRelease[], devOnlySections: Set<string>): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const release of releases) {
    if (release.version === undefined) {
      continue;
    }

    const version = release.version.replace(/^v/, '');
    const date =
      release.timestamp !== undefined ? new Date(release.timestamp * 1000).toISOString().slice(0, 10) : 'unreleased';

    const sectionMap = new Map<string, ChangelogItem[]>();

    for (const commit of release.commits ?? []) {
      const group = commit.group ?? 'Other';
      const description = extractDescription(commit.message);

      if (!sectionMap.has(group)) {
        sectionMap.set(group, []);
      }
      const items = sectionMap.get(group);
      if (items !== undefined) {
        items.push({ description });
      }
    }

    const sections: ChangelogSection[] = [];
    for (const [title, items] of sectionMap) {
      if (items.length === 0) {
        continue;
      }
      sections.push({
        title,
        audience: devOnlySections.has(title) ? 'dev' : 'all',
        items,
      });
    }

    if (sections.length > 0) {
      entries.push({ version, date, sections });
    }
  }

  return entries;
}

/** Extract the description from a commit message, stripping ticket ID and type prefix. */
function extractDescription(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  const afterColon = firstLine.split(': ').slice(1).join(': ');
  if (afterColon.length > 0) {
    return afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
  }
  return firstLine;
}

/** Read existing changelog entries from a JSON file, if it exists. */
function readExistingEntries(filePath: string): ChangelogEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!isUnknownArray(parsed)) {
      return [];
    }
    return parsed.filter(isChangelogEntry);
  } catch (error: unknown) {
    console.warn(
      `Warning: could not parse existing ${filePath}: ${error instanceof Error ? error.message : String(error)}; treating as empty`,
    );
    return [];
  }
}

/** Merge new entries with existing ones, replacing entries with matching versions. */
function mergeEntries(newEntries: ChangelogEntry[], existingEntries: ChangelogEntry[]): ChangelogEntry[] {
  const versionMap = new Map<string, ChangelogEntry>();

  for (const entry of existingEntries) {
    versionMap.set(entry.version, entry);
  }
  for (const entry of newEntries) {
    versionMap.set(entry.version, entry);
  }

  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  return [...versionMap.values()].sort((a, b) => {
    const partsA = a.version.split('.').map((s) => {
      const n = Number(s);
      return Number.isNaN(n) ? 0 : n;
    });
    const partsB = b.version.split('.').map((s) => {
      const n = Number(s);
      return Number.isNaN(n) ? 0 : n;
    });
    for (let i = 0; i < 3; i++) {
      const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}
