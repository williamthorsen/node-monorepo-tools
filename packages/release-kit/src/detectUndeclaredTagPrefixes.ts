import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';

/** A candidate tag prefix found in the repo that is not in the known-prefix set. */
export interface UndeclaredTagPrefix {
  /** The extracted prefix, including the trailing `-v` (e.g., `'core-v'`). */
  prefix: string;
  /** Count of tags matching this prefix. */
  tagCount: number;
  /** Up to `EXAMPLE_TAG_LIMIT` example tag names under this prefix. */
  exampleTags: string[];
  /**
   * Heuristic `dir` to suggest when offering a paste-ready config snippet; the prefix with
   * the trailing `-v` stripped. The operator may need to remap this to the actual workspace
   * directory basename.
   */
  suggestedDir: string;
}

/** Maximum number of example tags reported per undeclared prefix. */
const EXAMPLE_TAG_LIMIT = 3;

/**
 * Matches tags of the form `<kebab-prefix>-v<semver>` (optionally with a pre-release suffix).
 *
 * Anchored to lowercase-kebab prefixes to avoid matching arbitrary tag schemes; release-kit
 * produces tags in this shape, and legacy prefixes under consideration are expected to
 * follow the same convention.
 */
const CANDIDATE_TAG_PATTERN = /^(?<prefix>[a-z][a-z0-9-]*-v)\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

/**
 * Scans local git tags for release-shaped tags whose prefix is not in `knownPrefixes`, the union of derived and
 * declared prefixes across all workspaces.
 *
 * Reads only the local tag list, so a remote tag that has not been fetched is not reported. Returns an empty array
 * when the repo doesn't have any tags, or any candidate-shaped tags outside the known set.
 */
export function detectUndeclaredTagPrefixes(knownPrefixes: readonly string[]): UndeclaredTagPrefix[] {
  const known = new Set(knownPrefixes);

  let rawOutput: string;
  try {
    rawOutput = execFileSync('git', ['tag', '--list'], {
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Don't report any candidates when git or the repo is unavailable: The scan feeds advisory output only.
    return [];
  }

  const grouped = new Map<string, string[]>();
  for (const line of rawOutput.split('\n')) {
    const tag = line.trim();
    if (tag === '') continue;
    const match = CANDIDATE_TAG_PATTERN.exec(tag);
    if (match === null) continue;
    const prefix = match.groups?.['prefix'] ?? '';
    if (prefix === '' || known.has(prefix)) continue;

    let tags = grouped.get(prefix);
    if (tags === undefined) {
      tags = [];
      grouped.set(prefix, tags);
    }
    tags.push(tag);
  }

  const results: UndeclaredTagPrefix[] = [];
  for (const [prefix, tags] of grouped) {
    results.push({
      prefix,
      tagCount: tags.length,
      exampleTags: tags.slice(0, EXAMPLE_TAG_LIMIT),
      suggestedDir: stripTrailingTagMarker(prefix),
    });
  }

  return results.toSorted((a, b) => a.prefix.localeCompare(b.prefix));
}

/** Strips the trailing `-v` from a candidate prefix to suggest the workspace `dir`. */
function stripTrailingTagMarker(prefix: string): string {
  return prefix.endsWith('-v') ? prefix.slice(0, -2) : prefix;
}
