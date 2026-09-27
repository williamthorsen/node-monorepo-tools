import type { z } from 'zod';

import { isRecord } from './typeGuards.ts';
import { type ReleaseKitConfig, releaseKitConfigSchema } from './types.ts';

/**
 * Validates a raw config object loaded from `.config/release-kit.config.ts`. A config that fails the schema parse
 * returns `{}` with the errors; one that passes also goes through the cross-field checks.
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
      errors: [...deprecationErrors, ...parseResult.error.issues.map(formatZodIssue)],
      warnings: [],
    };
  }

  const config = parseResult.data;
  const errors = [...deprecationErrors];
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
      'cliffConfigPath is no longer supported. release-kit reads changelog history from git directly and uses no external config file. Remove this field from your config, and delete the file it names.',
    );
    delete cleaned['cliffConfigPath'];
  }

  if (isRecord(cleaned['releaseNotes']) && Object.hasOwn(cleaned['releaseNotes'], 'shouldCreateGithubRelease')) {
    errors.push(
      'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow, which `release-kit init` scaffolds. Remove this field from your config.',
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

  return { cleaned, deprecationErrors: errors };
}

/** Formats a Zod issue as a single-line error prefixed by its path; an issue without a path renders bare. */
function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = renderPath(issue.path);
  const message = customizeMessage(issue);
  return path === '' ? message : `${path}: ${message}`;
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
 * Appends per-entry errors when two entries in the same workspace's `legacyIdentities` share a full
 * `(name, tagPrefix)` tuple. Two entries with the same `tagPrefix` but different `name` are valid: They document a
 * prior rename that reused the tag shape.
 */
function detectLegacyIdentityDuplicates(config: ReleaseKitConfig, errors: string[]): void {
  if (config.workspaces === undefined) return;
  for (const [wsIndex, workspace] of config.workspaces.entries()) {
    if (workspace.legacyIdentities === undefined) continue;
    const seen = new Set<string>();
    for (const [entryIndex, identity] of workspace.legacyIdentities.entries()) {
      // Null-byte separator: neither npm names nor tag prefixes can contain `\0`,
      // so distinct `(name, tagPrefix)` tuples always produce distinct keys.
      const key = `${identity.name}\0${identity.tagPrefix}`;
      if (seen.has(key)) {
        errors.push(
          `workspaces[${wsIndex}].legacyIdentities[${entryIndex}]: duplicate identity (name='${identity.name}', tagPrefix='${identity.tagPrefix}')`,
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
 * Appends errors when a `retiredPackages[]` entry's `tagPrefix` matches any workspace's declared
 * `legacyIdentities[].tagPrefix`, naming the first workspace that declares it.
 *
 * A collision with an active workspace's *derived* `tagPrefix` requires reading each workspace's `package.json`, so
 * `loadConfig` checks it.
 */
function detectRetiredVsLegacyCollisions(config: ReleaseKitConfig, errors: string[]): void {
  if (config.retiredPackages === undefined || config.workspaces === undefined) return;

  const legacyPrefixToWorkspace = new Map<string, string>();
  for (const workspace of config.workspaces) {
    if (workspace.legacyIdentities === undefined) continue;
    for (const identity of workspace.legacyIdentities) {
      if (!legacyPrefixToWorkspace.has(identity.tagPrefix)) {
        legacyPrefixToWorkspace.set(identity.tagPrefix, workspace.dir);
      }
    }
  }

  for (const [index, retired] of config.retiredPackages.entries()) {
    const collidingDir = legacyPrefixToWorkspace.get(retired.tagPrefix);
    if (collidingDir !== undefined) {
      errors.push(
        `retiredPackages[${index}]: tagPrefix '${retired.tagPrefix}' collides with a declared legacyIdentities[].tagPrefix on workspace '${collidingDir}'`,
      );
    }
  }
}
