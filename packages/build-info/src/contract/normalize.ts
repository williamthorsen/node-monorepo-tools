import { InvalidBuildInfoError } from './InvalidBuildInfoError.ts';
import {
  BUILD_HOSTS,
  type BuildHost,
  type BuildInfo,
  type BuildInfoCommit,
  type BuildInfoDeployment,
  type BuildInfoReleaseNotes,
  type BuildInfoReleaseNotesItem,
  type BuildInfoReleaseNotesSection,
  type BuildInfoRepository,
  type BuildInfoRuntime,
} from './types.ts';

/** Matches an ISO 8601 date-time in UTC, with optional fractional seconds. */
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Returns a copy of the value that contains only the contract's keys, in the contract's order. Throws
 * `InvalidBuildInfoError` naming the first field that breaks the contract. An optional field that is `undefined` counts
 * as omitted; one that is `null` is invalid.
 */
export function normalizeBuildInfo(value: unknown): BuildInfo {
  const record = readRecord(value, '');
  if (record['schemaVersion'] !== 1) {
    throw new InvalidBuildInfoError('schemaVersion', 'expected 1');
  }

  const info: BuildInfo = {
    schemaVersion: 1,
    name: readNonEmptyString(record, 'name', ''),
    version: readNonEmptyString(record, 'version', ''),
    buildTime: readUtcTimestamp(record, 'buildTime', ''),
    host: readHost(record, 'host', ''),
    environment: readNonEmptyString(record, 'environment', ''),
  };
  assignIfPresent(info, 'commit', readOptional(record, 'commit', '', normalizeCommit));
  assignIfPresent(info, 'repository', readOptional(record, 'repository', '', normalizeRepository));
  assignIfPresent(info, 'deployment', readOptional(record, 'deployment', '', normalizeDeployment));
  assignIfPresent(info, 'runtime', readOptional(record, 'runtime', '', normalizeRuntime));
  assignIfPresent(info, 'releaseNotes', readOptional(record, 'releaseNotes', '', normalizeReleaseNotes));
  return info;
}

// region | Helpers

/** Sets the key on the target unless the value is `undefined`, so that an omitted field stays absent. */
function assignIfPresent<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

/** Reports whether the value is a plain object, excluding `null` and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Appends an array index to a field path, as in `sections[0]`. */
function joinIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

/** Appends a key to a field path, as in `commit.sha`, or returns the key alone at the top level. */
function joinKey(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/** Validates a commit and returns a copy that contains only the contract's keys. */
function normalizeCommit(value: unknown, path: string): BuildInfoCommit {
  const record = readRecord(value, path);
  const commit: BuildInfoCommit = {
    sha: readString(record, 'sha', path),
    shortSha: readString(record, 'shortSha', path),
  };
  assignIfPresent(commit, 'ref', readOptionalString(record, 'ref', path));
  assignIfPresent(commit, 'message', readOptionalString(record, 'message', path));
  assignIfPresent(commit, 'author', readOptionalString(record, 'author', path));
  assignIfPresent(commit, 'time', readOptionalString(record, 'time', path));
  assignIfPresent(commit, 'dirty', readOptional(record, 'dirty', path, readBoolean));
  return commit;
}

/** Validates a deployment and returns a copy that contains only the contract's keys. */
function normalizeDeployment(value: unknown, path: string): BuildInfoDeployment {
  const record = readRecord(value, path);
  const deployment: BuildInfoDeployment = {};
  assignIfPresent(deployment, 'id', readOptionalString(record, 'id', path));
  assignIfPresent(deployment, 'url', readOptionalString(record, 'url', path));
  assignIfPresent(deployment, 'pullRequest', readOptional(record, 'pullRequest', path, readNumber));
  return deployment;
}

/** Validates release notes and returns a copy that contains only the contract's keys. */
function normalizeReleaseNotes(value: unknown, path: string): BuildInfoReleaseNotes {
  const record = readRecord(value, path);
  const date = readOptionalString(record, 'date', path);
  const markdown = readString(record, 'markdown', path);
  const releaseNotes: BuildInfoReleaseNotes = date === undefined ? { markdown } : { date, markdown };
  assignIfPresent(
    releaseNotes,
    'sections',
    readOptional(record, 'sections', path, (sections, sectionsPath) =>
      readArray(sections, sectionsPath, normalizeReleaseNotesSection),
    ),
  );
  return releaseNotes;
}

/** Validates a release-note item and returns a copy that contains only the contract's keys. */
function normalizeReleaseNotesItem(value: unknown, path: string): BuildInfoReleaseNotesItem {
  const record = readRecord(value, path);
  const item: BuildInfoReleaseNotesItem = { description: readString(record, 'description', path) };
  assignIfPresent(item, 'body', readOptionalString(record, 'body', path));
  return item;
}

/** Validates a release-note section and returns a copy that contains only the contract's keys. */
function normalizeReleaseNotesSection(value: unknown, path: string): BuildInfoReleaseNotesSection {
  const record = readRecord(value, path);
  const title = readString(record, 'title', path);
  const itemsPath = joinKey(path, 'items');
  return { title, items: readArray(record['items'], itemsPath, normalizeReleaseNotesItem) };
}

/** Validates a repository and returns a copy that contains only the contract's keys. */
function normalizeRepository(value: unknown, path: string): BuildInfoRepository {
  const record = readRecord(value, path);
  return {
    provider: readString(record, 'provider', path),
    owner: readString(record, 'owner', path),
    name: readString(record, 'name', path),
    url: readString(record, 'url', path),
  };
}

/** Validates a runtime and returns a copy that contains only the contract's keys. */
function normalizeRuntime(value: unknown, path: string): BuildInfoRuntime {
  const record = readRecord(value, path);
  return { node: readString(record, 'node', path) };
}

/** Reads an array, normalizing each element under its indexed path. */
function readArray<T>(value: unknown, path: string, normalizeElement: (element: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) {
    throw new InvalidBuildInfoError(path, 'expected an array');
  }
  return value.map((element: unknown, index) => normalizeElement(element, joinIndex(path, index)));
}

/** Returns the value if it is a boolean, and throws otherwise. */
function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidBuildInfoError(path, 'expected a boolean');
  }
  return value;
}

/** Reads a host, rejecting any value outside `BUILD_HOSTS`. */
function readHost(record: Record<string, unknown>, key: string, path: string): BuildHost {
  const value = record[key];
  const host = BUILD_HOSTS.find((candidate) => candidate === value);
  if (host === undefined) {
    throw new InvalidBuildInfoError(joinKey(path, key), `expected one of ${BUILD_HOSTS.join(', ')}`);
  }
  return host;
}

/** Reads a string field, rejecting an empty string. */
function readNonEmptyString(record: Record<string, unknown>, key: string, path: string): string {
  const value = readString(record, key, path);
  if (value === '') {
    throw new InvalidBuildInfoError(joinKey(path, key), 'expected a non-empty string');
  }
  return value;
}

/** Returns the value if it is a finite number, and throws otherwise, including for `NaN` and `Infinity`. */
function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidBuildInfoError(path, 'expected a number');
  }
  return value;
}

/** Reads an optional field through the reader, returning `undefined` when the field is omitted. */
function readOptional<T>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  read: (value: unknown, path: string) => T,
): T | undefined {
  const value = record[key];
  return value === undefined ? undefined : read(value, joinKey(path, key));
}

/** Reads an optional string field, returning `undefined` when the field is omitted. */
function readOptionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  return readOptional(record, key, path, readStringValue);
}

/** Returns the value if it is a plain object, and throws otherwise. */
function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidBuildInfoError(path, 'expected an object');
  }
  return value;
}

/** Reads a string field of the record. */
function readString(record: Record<string, unknown>, key: string, path: string): string {
  return readStringValue(record[key], joinKey(path, key));
}

/** Returns the value if it is a string, and throws otherwise. */
function readStringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new InvalidBuildInfoError(path, 'expected a string');
  }
  return value;
}

/**
 * Reads an ISO 8601 timestamp in UTC, rejecting an offset other than `Z`, a missing time, and a day that does not
 * exist.
 */
function readUtcTimestamp(record: Record<string, unknown>, key: string, path: string): string {
  const value = readString(record, key, path);
  // Compare against the round trip, because `Date` rolls an impossible day such as February 30 into the next month.
  const parsed = new Date(value);
  if (
    !UTC_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new InvalidBuildInfoError(joinKey(path, key), 'expected an ISO 8601 timestamp in UTC');
  }
  return value;
}

// endregion | Helpers
