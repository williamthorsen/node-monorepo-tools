import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import { formatGlyphLine, isRecord, type OutputStyle } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { NMR_GLYPHS } from '../glyphs.ts';

/**
 * Prefix of node-build's definition files on the branch from which asdf-nodejs updates node-build before an install.
 * A version is installable through asdf once a file named for it exists here.
 */
export const NODE_BUILD_DEFINITION_URL = 'https://raw.githubusercontent.com/nodenv/node-build/main/share/node-build/';

/** Node's release index, which lists every release with its version and its UTC release day. */
export const NODE_RELEASE_INDEX_URL = 'https://nodejs.org/dist/index.json';

const TOOL_VERSIONS_FILE = '.tool-versions';

/**
 * Time after a release's UTC day begins before it is proposed. The index dates a release by day alone, so two days
 * from the start of that day is the earliest moment at which the release is certainly 24 hours old.
 */
const SOAK_MS = 2 * 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;

/** Matches the first `nodejs` entry of `.tool-versions`, capturing its first version up to any comment. */
const NODEJS_ENTRY_PATTERN = /^[ \t]*nodejs[ \t]+([^\s#]+)/m;

const PLAIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CheckNodePinOptions {
  /** Returns the parsed release index. Injected by tests; defaults to fetching `NODE_RELEASE_INDEX_URL`. */
  fetchReleases?: () => Promise<unknown>;
  /**
   * Reports whether node-build defines a version. Injected by tests; defaults to requesting the version's file under
   * `NODE_BUILD_DEFINITION_URL`.
   */
  isNodeBuildDefined?: (version: string) => Promise<boolean>;
  /** Suppresses the report, but not the warnings. */
  isSilent: boolean;
  /** The current time, against which the soak is measured. Injected by tests. */
  now?: Date;
  shouldWrite: boolean;
  /** Stream that the report and the warnings are written to. Defaults to `process.stderr`. */
  stderr?: Writable;
  style: OutputStyle;
}

/**
 * Reports the newest release in the major line of the `nodejs` pin in `dir`'s `.tool-versions` that is newer than
 * the pin, at least 24 hours old, and defined by node-build, and rewrites the pin to it when `shouldWrite` is set.
 * Reports the newest newer release that node-build does not define yet as held back.
 *
 * Reports nothing when the file or its `nodejs` entry is absent, or when the pin is current. Every failure is a
 * warning, so that the check never fails the upgrade that runs it.
 */
export async function checkNodePin(dir: string, options: CheckNodePinOptions): Promise<void> {
  const stderr = options.stderr ?? process.stderr;
  function report(message: string): void {
    stderr.write(`${formatGlyphLine(NMR_GLYPHS, options.style, 'pin', message)}\n`);
  }
  function warn(detail: string): void {
    report(`WARN: Could not check the nodejs pin: ${detail}`);
  }

  const filePath = path.join(dir, TOOL_VERSIONS_FILE);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) return;
    warn(describeError(error));
    return;
  }

  const pin = findNodePin(content);
  if (pin === undefined) return;
  if (!PLAIN_VERSION_PATTERN.test(pin.version)) {
    if (!options.isSilent) {
      report(`Skipped the nodejs pin '${pin.version}' in ${TOOL_VERSIONS_FILE}: Only an X.Y.Z version is checked.`);
    }
    return;
  }

  let releases: unknown;
  try {
    releases = await (options.fetchReleases ?? fetchNodeReleaseIndex)();
  } catch (error: unknown) {
    warn(`${NODE_RELEASE_INDEX_URL} is unreachable (${describeError(error)})`);
    return;
  }
  if (!Array.isArray(releases)) {
    warn(`${NODE_RELEASE_INDEX_URL} did not return a list of releases`);
    return;
  }

  const candidates = selectNodeUpgradeCandidates(pin.version, releases, options.now ?? new Date());
  let target: string | undefined;
  try {
    target = await findNewestDefined(candidates, options.isNodeBuildDefined ?? requestNodeBuildDefinition);
  } catch (error: unknown) {
    warn(`${NODE_BUILD_DEFINITION_URL} is unreachable (${describeError(error)})`);
    return;
  }

  const heldBack = candidates[0] === target ? undefined : candidates[0];
  function reportHeldBack(): void {
    if (heldBack !== undefined && !options.isSilent) {
      report(`nodejs ${heldBack} is held back: node-build does not define it yet.`);
    }
  }

  if (target === undefined) {
    reportHeldBack();
    return;
  }

  if (!options.shouldWrite) {
    if (!options.isSilent) {
      report(`nodejs ${pin.version} → ${target} is available. Run with --write to update ${TOOL_VERSIONS_FILE}.`);
    }
    reportHeldBack();
    return;
  }

  const updated = content.slice(0, pin.start) + target + content.slice(pin.start + pin.version.length);
  try {
    fs.writeFileSync(filePath, updated);
  } catch (error: unknown) {
    warn(describeError(error));
    return;
  }
  if (!options.isSilent) report(`Updated nodejs ${pin.version} → ${target} in ${TOOL_VERSIONS_FILE}.`);
  reportHeldBack();
}

/**
 * Returns every plain `X.Y.Z` release in `pin`'s major line that is newer than `pin` and whose UTC release day began
 * at least two days before `now`, newest first. Ignores an entry that lacks a plain version or a `YYYY-MM-DD` date.
 */
export function selectNodeUpgradeCandidates(pin: string, releases: readonly unknown[], now: Date): string[] {
  const pinParts = parseVersion(pin);
  const candidates: Array<{ parts: number[]; version: string }> = [];

  for (const release of releases) {
    if (!isRecord(release)) continue;
    const { date, version } = release;
    if (typeof version !== 'string' || typeof date !== 'string' || !RELEASE_DATE_PATTERN.test(date)) continue;

    const bareVersion = version.replace(/^v/, '');
    if (!PLAIN_VERSION_PATTERN.test(bareVersion)) continue;

    const parts = parseVersion(bareVersion);
    if (parts[0] !== pinParts[0] || compareVersions(parts, pinParts) <= 0) continue;
    if (Date.parse(`${date}T00:00:00Z`) + SOAK_MS > now.getTime()) continue;

    candidates.push({ parts, version: bareVersion });
  }

  return candidates.toSorted((a, b) => compareVersions(b.parts, a.parts)).map((candidate) => candidate.version);
}

// region | Helpers

/** Orders two version triples, returning a negative number, zero, or a positive number. */
function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Fetches Node's release index and returns its parsed body. Throws on a network failure or a non-2xx status. */
async function fetchNodeReleaseIndex(): Promise<unknown> {
  const response = await fetch(NODE_RELEASE_INDEX_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  return body;
}

/** Returns the first of the newest-first `candidates` that node-build defines, probing them in order. */
async function findNewestDefined(
  candidates: readonly string[],
  isDefined: (version: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isDefined(candidate)) return candidate;
  }
  return undefined;
}

/** Returns the first version of the first `nodejs` entry and its offset in `content`, if the file has one. */
function findNodePin(content: string): { start: number; version: string } | undefined {
  const match = NODEJS_ENTRY_PATTERN.exec(content);
  const version = match?.[1];
  if (match === null || version === undefined) return undefined;
  return { start: match.index + match[0].length - version.length, version };
}

/** Reports whether `error` is a filesystem error for a path that does not exist. */
function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

/** Splits a plain `X.Y.Z` version into its numeric parts. */
function parseVersion(version: string): number[] {
  return version.split('.').map(Number);
}

/**
 * Reports whether node-build defines `version`, from the status of a HEAD request for its definition file. Throws on
 * a network failure or on a status other than 200 or 404.
 */
async function requestNodeBuildDefinition(version: string): Promise<boolean> {
  const response = await fetch(`${NODE_BUILD_DEFINITION_URL}${version}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return false;
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  return true;
}

// endregion | Helpers
