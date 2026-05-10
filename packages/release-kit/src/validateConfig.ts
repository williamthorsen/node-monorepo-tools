import type { z } from 'zod';

import { isRecord } from './typeGuards.ts';
import type { ReleaseKitConfig } from './types.ts';
import { releaseKitConfigSchema } from './types.ts';

/**
 * Validate a raw config object loaded from `.config/release-kit.config.ts`.
 *
 * Single source of truth: `releaseKitConfigSchema` in `types.ts`, with
 * `ReleaseKitConfig = z.infer<typeof releaseKitConfigSchema>`. Adding a field to the type
 * without updating the schema is impossible because the type *is* derived from the
 * schema.
 *
 * Pipeline: (1) preprocess strips deprecated keys and emits migration-guidance errors;
 * (2) `releaseKitConfigSchema.safeParse` does shape validation; (3) post-parse cross-field
 * checks (full-tuple duplicates, retired-vs-legacy collisions) operate on the typed
 * result.
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
 * Strip removed/deprecated config keys and emit migration-guidance errors. The schema
 * uses `.strict()` everywhere, so unknown keys would otherwise be reported with Zod's
 * generic "Unrecognized key" message — losing the per-key migration instructions that
 * existing consumers rely on. This pass owns those messages and removes the keys from
 * the input so the schema parse only sees fields it recognizes.
 *
 * Contract: every removed/renamed config key must be handled here, not via Zod's
 * generic Unrecognized-key path. Future deprecations should add a branch below.
 */
function preprocessDeprecatedKeys(raw: unknown): { cleaned: unknown; deprecationErrors: string[] } {
  if (!isRecord(raw)) return { cleaned: raw, deprecationErrors: [] };

  const errors: string[] = [];
  const cleaned: Record<string, unknown> = { ...raw };

  if (isRecord(cleaned.releaseNotes) && 'shouldCreateGithubRelease' in cleaned.releaseNotes) {
    errors.push(
      'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow. Remove this field from your config; see README for the updated workflow.',
    );
    const releaseNotesCopy = { ...cleaned.releaseNotes };
    delete releaseNotesCopy.shouldCreateGithubRelease;
    cleaned.releaseNotes = releaseNotesCopy;
  }

  if (Array.isArray(cleaned.workspaces)) {
    cleaned.workspaces = cleaned.workspaces.map((ws: unknown, i: number): unknown => {
      if (!isRecord(ws)) return ws;
      const wsCopy = { ...ws };
      if ('tagPrefix' in wsCopy) {
        const dir = typeof wsCopy.dir === 'string' && wsCopy.dir !== '' ? wsCopy.dir : '<dir>';
        errors.push(`workspaces[${i}]: 'tagPrefix' is no longer supported; remove it to use the default '${dir}-v'`);
        delete wsCopy.tagPrefix;
      }
      if ('legacyTagPrefixes' in wsCopy) {
        errors.push(
          `workspaces[${i}]: 'legacyTagPrefixes' is no longer supported; use 'legacyIdentities: [{ name, tagPrefix }, ...]' instead`,
        );
        delete wsCopy.legacyTagPrefixes;
      }
      return wsCopy;
    });
  }

  return { cleaned, deprecationErrors: errors };
}

/**
 * Format a Zod issue as a single-line error string using the project's existing path
 * convention (`object.key`, `array[index]`). Top-level issues without a path render bare.
 *
 * The message body is Zod's default with one targeted exception: `too_small` on strings
 * is rephrased as "must be a non-empty string" because Zod's "Too small: expected string
 * to have >=N characters" reads as a numeric-bound error in CLI output.
 */
function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = renderPath(issue.path);
  const message = customizeMessage(issue);
  return path === '' ? message : `${path}: ${message}`;
}

/** Apply targeted message customizations to Zod's defaults. */
function customizeMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return 'must be a non-empty string';
  }
  return issue.message;
}

/** Render a Zod path as `top.nested[2].leaf`. */
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
 * Append per-entry errors when two entries in the same workspace's `legacyIdentities`
 * share a full `(name, tagPrefix)` tuple. Two entries with the same `tagPrefix` but
 * different `name` are valid — they document a prior rename that reused the tag shape.
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
 * Append per-entry errors for full `(name, tagPrefix)` duplicates within `retiredPackages`.
 * Two entries with the same `tagPrefix` but different `name` are valid — they document a
 * package renamed before retirement.
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
 * Append errors when a `retiredPackages[]` entry's `tagPrefix` matches any workspace's
 * declared `legacyIdentities[].tagPrefix`. The first declaring workspace is named in the
 * error.
 *
 * Collisions with an active workspace's *derived* `tagPrefix` are not checked here — that
 * check requires reading each workspace's `package.json` and lives in `loadConfig`.
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
