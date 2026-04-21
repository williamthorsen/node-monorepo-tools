import { execFileSync } from 'node:child_process';

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
 * Scan local git tags for release-shaped tags whose prefix is not in the known set.
 *
 * Reads only the local tag list; callers expecting to see recently-fetched remote tags
 * should `git fetch --tags` first. Returns an empty array when the repo has no tags
 * or no candidate-shaped tags outside the known set.
 *
 * @param knownPrefixes - Union of derived and declared prefixes across all workspaces.
 */
export function detectUndeclaredTagPrefixes(knownPrefixes: readonly string[]): UndeclaredTagPrefix[] {
  const known = new Set(knownPrefixes);

  let rawOutput: string;
  try {
    rawOutput = execFileSync('git', ['tag', '--list'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // No accessible git repo or git unavailable — treat as "no candidates" rather than throwing.
    return [];
  }

  const grouped = new Map<string, string[]>();
  for (const line of rawOutput.split('\n')) {
    const tag = line.trim();
    if (tag === '') continue;
    const match = CANDIDATE_TAG_PATTERN.exec(tag);
    if (match === null) continue;
    const prefix = match.groups?.prefix ?? '';
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

  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node >=20; engine target is >=18.17.0
  return results.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** Strip the trailing `-v` from a candidate prefix to suggest the workspace `dir`. */
function stripTrailingTagMarker(prefix: string): string {
  return prefix.endsWith('-v') ? prefix.slice(0, -2) : prefix;
}
