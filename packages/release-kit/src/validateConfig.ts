import type { z } from 'zod';

import { type LegacyIdentity, type ReleaseKitConfig, releaseKitConfigSchema } from './configSchema.ts';
import { isRecord } from './typeGuards.ts';

/**
 * Validates a raw config object loaded from `.config/release-kit.config.ts`. Returns `{}` with the errors for a config
 * that fails the schema parse, and runs the cross-field checks on one that passes.
 */
export function validateConfig(raw: unknown): { config: ReleaseKitConfig; errors: string[]; warnings: string[] } {
  if (!isRecord(raw)) {
    return { config: {}, errors: ['Config must be an object'], warnings: [] };
  }

  const { cleaned, deprecationErrors } = preprocessDeprecatedKeys(raw);

  const parseResult = releaseKitConfigSchema.safeParse(cleaned);
  if (!parseResult.success) {
    return {
      config: {},
      errors: [...deprecationErrors, ...parseResult.error.issues.flatMap((issue) => formatZodIssue(issue, cleaned))],
      warnings: [],
    };
  }

  const config = parseResult.data;
  const errors = [...deprecationErrors];
  detectReleasesConflicts(config, errors);
  detectLegacyIdentityDuplicates(config, errors);
  detectRetiredPackageDuplicates(config, errors);
  detectRetiredVsLegacyCollisions(config, errors);

  // Cross-field warnings: releaseNotes features require changelogJson to be enabled.
  const warnings: string[] = [];
  const changelogJsonEnabled = config.changelogJson?.enabled ?? true;
  if (!changelogJsonEnabled && config.releaseNotes?.shouldInjectIntoReadme) {
    warnings.push(
      'releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false; README injection will be skipped at runtime',
    );
  }

  return { config, errors, warnings };
}

/**
 * Strips removed config keys from the input and reports a migration-guidance error for each. Every object schema is
 * `.strict()`, so a removed key left in place would fail with Zod's generic "Unrecognized key" message, which omits
 * the migration instructions; every removed or renamed key is therefore handled here.
 */
function preprocessDeprecatedKeys(raw: unknown): { cleaned: unknown; deprecationErrors: string[] } {
  if (!isRecord(raw)) return { cleaned: raw, deprecationErrors: [] };

  const errors: string[] = [];
  const cleaned: Record<string, unknown> = { ...raw };

  if (Object.hasOwn(cleaned, 'cliffConfigPath')) {
    errors.push(
      'cliffConfigPath is no longer supported. release-kit reads changelog history from git directly and does not use any external config file. Remove this field from the config, and delete the file that it names.',
    );
    delete cleaned['cliffConfigPath'];
  }

  if (isRecord(cleaned['releaseNotes']) && Object.hasOwn(cleaned['releaseNotes'], 'shouldCreateGithubRelease')) {
    errors.push(
      'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow, which `release-kit init` scaffolds. Remove this field from the config.',
    );
    const releaseNotesCopy = { ...cleaned['releaseNotes'] };
    delete releaseNotesCopy['shouldCreateGithubRelease'];
    cleaned['releaseNotes'] = releaseNotesCopy;
  }

  if (Array.isArray(cleaned['workspaces'])) {
    cleaned['workspaces'] = cleaned['workspaces'].map((ws: unknown, i: number): unknown => {
      if (!isRecord(ws)) return ws;
      const wsCopy = { ...ws };
      if (Object.hasOwn(wsCopy, 'tagPrefix')) {
        const dir = typeof wsCopy['dir'] === 'string' && wsCopy['dir'] !== '' ? wsCopy['dir'] : '<dir>';
        errors.push(`workspaces[${i}]: 'tagPrefix' is no longer supported; remove it to use the default '${dir}-v'`);
        delete wsCopy['tagPrefix'];
      }
      if (Object.hasOwn(wsCopy, 'legacyTagPrefixes')) {
        errors.push(
          `workspaces[${i}]: 'legacyTagPrefixes' is no longer supported; use 'legacyIdentities: [{ name, tagPrefix }, ...]' instead`,
        );
        delete wsCopy['legacyTagPrefixes'];
      }
      return wsCopy;
    });
  }

  if (isRecord(cleaned['releases'])) {
    const releasesCopy: Record<string, unknown> = { ...cleaned['releases'] };
    for (const [name, entry] of Object.entries(releasesCopy)) {
      if (!isRecord(entry) || !Object.hasOwn(entry, 'paths')) continue;
      errors.push(
        `releases.${name}: 'paths' is not supported; a package's or a directory's commit window is its path, and a composite's is the union of its members' windows`,
      );
      const entryCopy = { ...entry };
      delete entryCopy['paths'];
      releasesCopy[name] = entryCopy;
    }
    cleaned['releases'] = releasesCopy;
  }

  return { cleaned, deprecationErrors: errors };
}

/**
 * Formats a Zod issue as single-line errors prefixed by their path, or as the bare message when the issue doesn't have
 * a path. A failed `releases` entry is reported through the branch of `releaseEntrySchema` that its keys select, since
 * the union's own message doesn't say which shape was meant or what it lacks.
 */
function formatZodIssue(issue: z.core.$ZodIssue, input: unknown): string[] {
  if (issue.code === 'invalid_union' && issue.path.length === 2 && issue.path[0] === 'releases') {
    const branchIssues = issue.errors[selectReleaseEntryBranch(readAtPath(input, issue.path))];
    if (branchIssues === undefined) {
      return [`${renderPath(issue.path)}: ${RELEASE_ENTRY_SHAPES}`];
    }
    return branchIssues.flatMap((branchIssue) =>
      formatZodIssue({ ...branchIssue, path: [...issue.path, ...branchIssue.path] }, input),
    );
  }

  const path = renderPath(issue.path);
  const message = customizeMessage(issue);
  return [path === '' ? message : `${path}: ${message}`];
}

/**
 * Returns Zod's message for an issue, except that a string `too_small` issue becomes "must be a non-empty string",
 * because Zod's "Too small: expected string to have >=N characters" reads as a numeric-bound error in CLI output.
 */
function customizeMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return 'must be a non-empty string';
  }
  return issue.message;
}

/** Message for a `releases` entry whose keys don't select any of the entry shapes. */
const RELEASE_ENTRY_SHAPES = 'must be false, { path, tagPrefix?, legacyIdentities? }, or { includes, tagPrefix? }';

/** Renders a Zod path as `top.nested[2].leaf`. */
function renderPath(path: ReadonlyArray<PropertyKey>): string {
  let rendered = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else if (rendered === '') {
      rendered += String(segment);
    } else {
      rendered += `.${String(segment)}`;
    }
  }
  return rendered;
}

/**
 * Appends per-entry errors when two entries in the same target's `legacyIdentities` share a full
 * `(name, tagPrefix)` tuple. Two entries with the same `tagPrefix` but different `name` are valid: They document a
 * prior rename that reused the tag shape.
 */
function detectLegacyIdentityDuplicates(config: ReleaseKitConfig, errors: string[]): void {
  for (const { label, legacyIdentities } of listLegacyIdentityDeclarations(config)) {
    const seen = new Set<string>();
    for (const [entryIndex, identity] of legacyIdentities.entries()) {
      // Null-byte separator: neither npm names nor tag prefixes can contain `\0`,
      // so distinct `(name, tagPrefix)` tuples always produce distinct keys.
      const key = `${identity.name}\0${identity.tagPrefix}`;
      if (seen.has(key)) {
        errors.push(
          `${label}.legacyIdentities[${entryIndex}]: duplicate identity (name='${identity.name}', tagPrefix='${identity.tagPrefix}')`,
        );
      }
      seen.add(key);
    }
  }
}

/**
 * Appends per-entry errors for full `(name, tagPrefix)` duplicates within `retiredPackages`. Two entries with the
 * same `tagPrefix` but different `name` are valid: They document a package renamed before retirement.
 */
function detectRetiredPackageDuplicates(config: ReleaseKitConfig, errors: string[]): void {
  if (config.retiredPackages === undefined) return;
  const seen = new Set<string>();
  for (const [index, retired] of config.retiredPackages.entries()) {
    const key = `${retired.name}\0${retired.tagPrefix}`;
    if (seen.has(key)) {
      errors.push(
        `retiredPackages[${index}]: duplicate package (name='${retired.name}', tagPrefix='${retired.tagPrefix}')`,
      );
    }
    seen.add(key);
  }
}

/**
 * Appends errors when a `retiredPackages[]` entry's `tagPrefix` matches any declared `legacyIdentities[].tagPrefix`,
 * naming the first workspace or release target that declares it.
 *
 * A collision with an active workspace's *derived* `tagPrefix` requires reading each workspace's `package.json`, so
 * `loadConfig` checks it.
 */
function detectRetiredVsLegacyCollisions(config: ReleaseKitConfig, errors: string[]): void {
  if (config.retiredPackages === undefined) return;

  const legacyPrefixToOwner = new Map<string, string>();
  for (const { owner, legacyIdentities } of listLegacyIdentityDeclarations(config)) {
    for (const identity of legacyIdentities) {
      if (!legacyPrefixToOwner.has(identity.tagPrefix)) {
        legacyPrefixToOwner.set(identity.tagPrefix, owner);
      }
    }
  }

  for (const [index, retired] of config.retiredPackages.entries()) {
    const collidingOwner = legacyPrefixToOwner.get(retired.tagPrefix);
    if (collidingOwner !== undefined) {
      errors.push(
        `retiredPackages[${index}]: tagPrefix '${retired.tagPrefix}' collides with a declared legacyIdentities[].tagPrefix on ${collidingOwner}`,
      );
    }
  }
}

/** Appends an error when `releases` is combined with `workspaces` or `project`, which declare the same targets. */
function detectReleasesConflicts(config: ReleaseKitConfig, errors: string[]): void {
  if (config.releases === undefined) return;
  const legacyBlocks = [
    ...(config.workspaces === undefined ? [] : ['workspaces']),
    ...(config.project === undefined ? [] : ['project']),
  ];
  if (legacyBlocks.length === 0) return;
  errors.push(
    `releases cannot be combined with ${legacyBlocks.join(' or ')}; declare every target under releases, or remove releases`,
  );
}

/**
 * Lists every declaration of `legacyIdentities`, from `workspaces` overrides and `releases` package entries, with the
 * path that labels its errors and a description of its owner.
 */
function listLegacyIdentityDeclarations(
  config: ReleaseKitConfig,
): Array<{ label: string; owner: string; legacyIdentities: LegacyIdentity[] }> {
  const fromWorkspaces = (config.workspaces ?? []).flatMap((workspace, index) =>
    workspace.legacyIdentities === undefined
      ? []
      : [
          {
            label: `workspaces[${index}]`,
            owner: `workspace '${workspace.dir}'`,
            legacyIdentities: workspace.legacyIdentities,
          },
        ],
  );
  const fromReleases = Object.entries(config.releases ?? {}).flatMap(([name, entry]) =>
    entry === false || !('path' in entry) || entry.legacyIdentities === undefined
      ? []
      : [{ label: `releases.${name}`, owner: `release '${name}'`, legacyIdentities: entry.legacyIdentities }],
  );
  return [...fromWorkspaces, ...fromReleases];
}

/** Returns the value at a Zod issue path within the input, or `undefined` when the path leaves the input. */
function readAtPath(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let value = input;
  for (const segment of path) {
    if (!isRecord(value) || typeof segment === 'symbol') return undefined;
    value = value[String(segment)];
  }
  return value;
}

/**
 * Returns the index of the `releaseEntrySchema` branch that a failed entry's keys select: the package shape for a
 * `path` key, the composite shape for an `includes` key, and an index past the branches otherwise.
 */
function selectReleaseEntryBranch(entry: unknown): number {
  if (!isRecord(entry)) return -1;
  if (Object.hasOwn(entry, 'includes')) return 2;
  if (Object.hasOwn(entry, 'path')) return 1;
  return -1;
}
