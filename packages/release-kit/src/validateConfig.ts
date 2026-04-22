import { isRecord } from './typeGuards.ts';
import type { LegacyIdentity, ReleaseKitConfig, RetiredPackage } from './types.ts';

/**
 * Validates a raw config object loaded from `.config/release-kit.config.ts`.
 *
 * Returns an array of validation error messages. An empty array means the config is valid.
 * Uses hand-coded type guards rather than a schema library.
 */
export function validateConfig(raw: unknown): { config: ReleaseKitConfig; errors: string[]; warnings: string[] } {
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { config: {}, errors: ['Config must be an object'], warnings: [] };
  }

  const config: ReleaseKitConfig = {};

  // Detect unknown fields
  const knownFields = new Set([
    'changelogJson',
    'cliffConfigPath',
    'formatCommand',
    'releaseNotes',
    'retiredPackages',
    'scopeAliases',
    'versionPatterns',
    'workspaces',
    'workTypes',
  ]);

  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      errors.push(`Unknown field: '${key}'`);
    }
  }

  validateChangelogJson(raw.changelogJson, config, errors);
  validateWorkspaces(raw.workspaces, config, errors);
  validateReleaseNotes(raw.releaseNotes, config, errors);
  validateVersionPatterns(raw.versionPatterns, config, errors);
  validateWorkTypes(raw.workTypes, config, errors);
  validateStringField('formatCommand', raw.formatCommand, config, errors);
  validateStringField('cliffConfigPath', raw.cliffConfigPath, config, errors);
  validateScopeAliases(raw.scopeAliases, config, errors);
  validateRetiredPackages(raw.retiredPackages, config, errors);

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

function validateChangelogJson(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    errors.push("'changelogJson' must be an object");
    return;
  }

  const knownChangelogJsonFields = new Set(['enabled', 'outputPath', 'devOnlySections']);
  for (const key of Object.keys(value)) {
    if (!knownChangelogJsonFields.has(key)) {
      errors.push(`changelogJson: unknown field '${key}'`);
    }
  }

  const result: NonNullable<ReleaseKitConfig['changelogJson']> = {};

  if (value.enabled !== undefined) {
    if (typeof value.enabled === 'boolean') {
      result.enabled = value.enabled;
    } else {
      errors.push('changelogJson.enabled: must be a boolean');
    }
  }

  if (value.outputPath !== undefined) {
    if (typeof value.outputPath === 'string') {
      result.outputPath = value.outputPath;
    } else {
      errors.push('changelogJson.outputPath: must be a string');
    }
  }

  if (value.devOnlySections !== undefined) {
    if (isStringArray(value.devOnlySections)) {
      result.devOnlySections = value.devOnlySections;
    } else {
      errors.push('changelogJson.devOnlySections: must be a string array');
    }
  }

  config.changelogJson = result;
}

function validateReleaseNotes(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    errors.push("'releaseNotes' must be an object");
    return;
  }

  const knownReleaseNotesFields = new Set(['shouldInjectIntoReadme']);
  for (const key of Object.keys(value)) {
    if (!knownReleaseNotesFields.has(key)) {
      if (key === 'shouldCreateGithubRelease') {
        errors.push(
          'releaseNotes.shouldCreateGithubRelease is no longer supported. Adoption is now signaled by installing the create-github-release workflow. Remove this field from your config; see README for the updated workflow.',
        );
      } else {
        errors.push(`releaseNotes: unknown field '${key}'`);
      }
    }
  }

  const result: NonNullable<ReleaseKitConfig['releaseNotes']> = {};

  if (value.shouldInjectIntoReadme !== undefined) {
    if (typeof value.shouldInjectIntoReadme === 'boolean') {
      result.shouldInjectIntoReadme = value.shouldInjectIntoReadme;
    } else {
      errors.push('releaseNotes.shouldInjectIntoReadme: must be a boolean');
    }
  }

  config.releaseNotes = result;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateWorkspaces(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    errors.push("'workspaces' must be an array");
    return;
  }

  const workspaces: NonNullable<ReleaseKitConfig['workspaces']> = [];
  const knownWorkspaceFields = new Set(['dir', 'shouldExclude', 'legacyIdentities']);
  for (const [i, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`workspaces[${i}]: must be an object`);
      continue;
    }
    if (typeof entry.dir !== 'string' || entry.dir === '') {
      errors.push(`workspaces[${i}]: 'dir' is required`);
      continue;
    }

    // Detect unknown or removed fields
    for (const key of Object.keys(entry)) {
      if (!knownWorkspaceFields.has(key)) {
        if (key === 'tagPrefix') {
          errors.push(
            `workspaces[${i}]: 'tagPrefix' is no longer supported; remove it to use the default '${entry.dir}-v'`,
          );
        } else if (key === 'legacyTagPrefixes') {
          errors.push(
            `workspaces[${i}]: 'legacyTagPrefixes' is no longer supported; use 'legacyIdentities: [{ name, tagPrefix }, ...]' instead`,
          );
        } else {
          errors.push(`workspaces[${i}]: unknown field '${key}'`);
        }
      }
    }

    const workspace: NonNullable<ReleaseKitConfig['workspaces']>[number] = { dir: entry.dir };

    if (entry.shouldExclude !== undefined) {
      if (typeof entry.shouldExclude === 'boolean') {
        workspace.shouldExclude = entry.shouldExclude;
      } else {
        errors.push(`workspaces[${i}]: 'shouldExclude' must be a boolean`);
      }
    }

    if (entry.legacyIdentities !== undefined) {
      const identities = validateLegacyIdentities(entry.legacyIdentities, i, errors);
      if (identities !== undefined) {
        workspace.legacyIdentities = identities;
      }
    }
    workspaces.push(workspace);
  }
  config.workspaces = workspaces;
}

/**
 * Validate a `legacyIdentities` field on a workspace override.
 *
 * Accepts an array of records, each with non-empty string `name` and `tagPrefix` fields and
 * no unknown fields. Rejects full-tuple duplicates (two entries whose `name` and `tagPrefix`
 * both match). Appends a per-entry error for each invalid entry and returns the array of
 * valid entries (including partial results when some entries fail). Returns `undefined`
 * only when the top-level value is not an array.
 */
function validateLegacyIdentities(
  value: unknown,
  workspaceIndex: number,
  errors: string[],
): LegacyIdentity[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`workspaces[${workspaceIndex}]: 'legacyIdentities' must be an array`);
    return undefined;
  }

  const knownIdentityFields = new Set(['name', 'tagPrefix']);
  const identities: LegacyIdentity[] = [];
  const seenTuples = new Set<string>();

  for (const [entryIndex, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}]: must be an object`);
      continue;
    }

    let entryValid = true;
    for (const key of Object.keys(entry)) {
      if (!knownIdentityFields.has(key)) {
        errors.push(`workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}]: unknown field '${key}'`);
        entryValid = false;
      }
    }

    const { name, tagPrefix } = entry;
    if (typeof name !== 'string') {
      errors.push(`workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}].name: must be a string`);
      entryValid = false;
    } else if (name === '') {
      errors.push(`workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}].name: must be a non-empty string`);
      entryValid = false;
    }

    if (typeof tagPrefix !== 'string') {
      errors.push(`workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}].tagPrefix: must be a string`);
      entryValid = false;
    } else if (tagPrefix === '') {
      errors.push(
        `workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}].tagPrefix: must be a non-empty string`,
      );
      entryValid = false;
    }

    if (!entryValid || typeof name !== 'string' || typeof tagPrefix !== 'string') {
      continue;
    }

    // Use a null-byte separator: neither npm names nor tag prefixes can contain `\0`,
    // so distinct `(name, tagPrefix)` tuples always produce distinct keys.
    const key = `${name}\0${tagPrefix}`;
    if (seenTuples.has(key)) {
      errors.push(
        `workspaces[${workspaceIndex}].legacyIdentities[${entryIndex}]: duplicate identity (name='${name}', tagPrefix='${tagPrefix}')`,
      );
      continue;
    }
    seenTuples.add(key);
    identities.push({ name, tagPrefix });
  }

  return identities;
}

/**
 * Validate a top-level `retiredPackages` field.
 *
 * Accepts an array of records, each with non-empty string `name` and `tagPrefix` and an
 * optional non-empty string `successor`. Rejects full-tuple `(name, tagPrefix)` duplicates
 * within the array (two entries sharing the same `tagPrefix` but different `name`s are
 * allowed — this documents a package renamed before retirement). After per-entry validation,
 * rejects any `tagPrefix` that collides with a declared `workspaces[].legacyIdentities[].tagPrefix`.
 *
 * Collisions with an active workspace's *derived* `tagPrefix` are not checked here — that
 * check requires reading each workspace's `package.json` and belongs in `loadConfig`.
 */
function validateRetiredPackages(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    errors.push("'retiredPackages' must be an array");
    return;
  }

  const retiredPackages: RetiredPackage[] = [];
  const seenTuples = new Set<string>();

  for (const [i, entry] of value.entries()) {
    const retired = validateRetiredPackageEntry(entry, i, errors);
    if (retired === undefined) continue;

    // Null-byte separator: neither npm names nor tag prefixes can contain `\0`.
    const key = `${retired.name}\0${retired.tagPrefix}`;
    if (seenTuples.has(key)) {
      errors.push(
        `retiredPackages[${i}]: duplicate package (name='${retired.name}', tagPrefix='${retired.tagPrefix}')`,
      );
      continue;
    }
    seenTuples.add(key);
    retiredPackages.push(retired);
  }

  detectRetiredVsLegacyCollisions(retiredPackages, config, errors);

  config.retiredPackages = retiredPackages;
}

/**
 * Validate a single `retiredPackages[i]` entry. Returns the parsed entry when every required
 * field is a valid non-empty string (and `successor`, if present, is too). Appends any errors
 * encountered and returns `undefined` for otherwise-invalid entries.
 */
function validateRetiredPackageEntry(entry: unknown, i: number, errors: string[]): RetiredPackage | undefined {
  if (!isRecord(entry)) {
    errors.push(`retiredPackages[${i}]: must be an object`);
    return undefined;
  }

  const knownRetiredFields = new Set(['name', 'tagPrefix', 'successor']);
  let entryValid = true;
  for (const key of Object.keys(entry)) {
    if (!knownRetiredFields.has(key)) {
      errors.push(`retiredPackages[${i}]: unknown field '${key}'`);
      entryValid = false;
    }
  }

  const { name, tagPrefix, successor } = entry;
  if (!validateNonEmptyString(name, `retiredPackages[${i}].name`, errors)) {
    entryValid = false;
  }
  if (!validateNonEmptyString(tagPrefix, `retiredPackages[${i}].tagPrefix`, errors)) {
    entryValid = false;
  }
  if (successor !== undefined && !validateNonEmptyString(successor, `retiredPackages[${i}].successor`, errors)) {
    entryValid = false;
  }

  if (!entryValid || typeof name !== 'string' || typeof tagPrefix !== 'string') {
    return undefined;
  }

  const retired: RetiredPackage = { name, tagPrefix };
  if (typeof successor === 'string' && successor !== '') {
    retired.successor = successor;
  }
  return retired;
}

/**
 * Append errors when a `retiredPackages` entry's `tagPrefix` matches any workspace's declared
 * `legacyIdentities[].tagPrefix`. The first declaring workspace is named in the error.
 */
function detectRetiredVsLegacyCollisions(
  retiredPackages: readonly RetiredPackage[],
  config: ReleaseKitConfig,
  errors: string[],
): void {
  if (config.workspaces === undefined) return;

  const legacyPrefixToWorkspace = new Map<string, string>();
  for (const workspace of config.workspaces) {
    if (workspace.legacyIdentities === undefined) continue;
    for (const identity of workspace.legacyIdentities) {
      if (!legacyPrefixToWorkspace.has(identity.tagPrefix)) {
        legacyPrefixToWorkspace.set(identity.tagPrefix, workspace.dir);
      }
    }
  }

  for (const [i, retired] of retiredPackages.entries()) {
    const collidingDir = legacyPrefixToWorkspace.get(retired.tagPrefix);
    if (collidingDir !== undefined) {
      errors.push(
        `retiredPackages[${i}]: tagPrefix '${retired.tagPrefix}' collides with a declared legacyIdentities[].tagPrefix on workspace '${collidingDir}'`,
      );
    }
  }
}

/**
 * Append a typed error when `value` is not a non-empty string under `fieldPath`. Returns `true`
 * when the value passes, `false` when any error was appended.
 */
function validateNonEmptyString(value: unknown, fieldPath: string, errors: string[]): boolean {
  if (typeof value !== 'string') {
    errors.push(`${fieldPath}: must be a string`);
    return false;
  }
  if (value === '') {
    errors.push(`${fieldPath}: must be a non-empty string`);
    return false;
  }
  return true;
}

function validateVersionPatterns(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    errors.push("'versionPatterns' must be an object");
    return;
  }

  if (!isStringArray(value.major)) {
    errors.push('versionPatterns.major: expected string array');
  }
  if (!isStringArray(value.minor)) {
    errors.push('versionPatterns.minor: expected string array');
  }
  if (isStringArray(value.major) && isStringArray(value.minor)) {
    config.versionPatterns = { major: value.major, minor: value.minor };
  }
}

function validateWorkTypes(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value) || Array.isArray(value)) {
    errors.push("'workTypes' must be a record (object)");
    return;
  }

  const workTypes: Record<string, { header: string; aliases?: string[] }> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      errors.push(`workTypes.${key}: must be an object`);
      continue;
    }
    if (typeof entry.header !== 'string') {
      errors.push(`workTypes.${key}: 'header' is required and must be a string`);
      continue;
    }
    const wtEntry: { header: string; aliases?: string[] } = { header: entry.header };
    if (entry.aliases !== undefined) {
      if (isStringArray(entry.aliases)) {
        wtEntry.aliases = entry.aliases;
      } else {
        errors.push(`workTypes.${key}: 'aliases' must be a string array`);
      }
    }
    workTypes[key] = wtEntry;
  }
  config.workTypes = workTypes;
}

function validateStringField(
  fieldName: 'formatCommand' | 'cliffConfigPath',
  value: unknown,
  config: ReleaseKitConfig,
  errors: string[],
): void {
  if (value === undefined) return;

  if (typeof value !== 'string') {
    errors.push(`'${fieldName}' must be a string`);
    return;
  }
  config[fieldName] = value;
}

function validateScopeAliases(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    errors.push("'scopeAliases' must be a record (object)");
    return;
  }

  const aliases: Record<string, string> = {};
  let valid = true;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      aliases[key] = v;
    } else {
      errors.push(`scopeAliases.${key}: value must be a string`);
      valid = false;
    }
  }
  // All-or-nothing: only assign aliases when every entry is valid.
  // Unlike `validateWorkspaces`, partial results are not useful for aliases
  // because the mapping is consumed as a complete lookup table.
  if (valid) {
    config.scopeAliases = aliases;
  }
}
