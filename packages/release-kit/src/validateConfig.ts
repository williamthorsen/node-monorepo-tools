import { isRecord } from './typeGuards.ts';
import type { ReleaseKitConfig } from './types.ts';

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
  const knownWorkspaceFields = new Set(['dir', 'shouldExclude', 'legacyTagPrefixes']);
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

    if (entry.legacyTagPrefixes !== undefined) {
      const legacy = validateLegacyTagPrefixes(entry.legacyTagPrefixes, i, errors);
      if (legacy !== undefined) {
        workspace.legacyTagPrefixes = legacy;
      }
    }
    workspaces.push(workspace);
  }
  config.workspaces = workspaces;
}

/**
 * Validate a `legacyTagPrefixes` field on a workspace override.
 *
 * Accepts a string array with non-empty entries. Returns the validated array, or `undefined`
 * when validation fails (with errors appended to the caller's list).
 */
function validateLegacyTagPrefixes(value: unknown, workspaceIndex: number, errors: string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`workspaces[${workspaceIndex}]: 'legacyTagPrefixes' must be a string array`);
    return undefined;
  }

  const prefixes: string[] = [];
  let valid = true;
  for (const [entryIndex, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      errors.push(`workspaces[${workspaceIndex}].legacyTagPrefixes[${entryIndex}]: must be a string`);
      valid = false;
      continue;
    }
    if (entry === '') {
      errors.push(`workspaces[${workspaceIndex}].legacyTagPrefixes[${entryIndex}]: must be a non-empty string`);
      valid = false;
      continue;
    }
    prefixes.push(entry);
  }

  return valid ? prefixes : undefined;
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
