import type { ReleaseKitConfig } from './types.ts';

/**
 * Validates a raw config object loaded from `.config/release-kit.config.ts`.
 *
 * Returns an array of validation error messages. An empty array means the config is valid.
 * Uses hand-coded type guards rather than a schema library.
 */
export function validateConfig(raw: unknown): { config: ReleaseKitConfig; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { config: {}, errors: ['Config must be an object'] };
  }

  const config: ReleaseKitConfig = {};

  // Detect unknown fields
  const knownFields = new Set([
    'components',
    'versionPatterns',
    'workTypes',
    'formatCommand',
    'cliffConfigPath',
    'workspaceAliases',
  ]);

  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      errors.push(`Unknown field: '${key}'`);
    }
  }

  validateComponents(raw.components, config, errors);
  validateVersionPatterns(raw.versionPatterns, config, errors);
  validateWorkTypes(raw.workTypes, config, errors);
  validateStringField('formatCommand', raw.formatCommand, config, errors);
  validateStringField('cliffConfigPath', raw.cliffConfigPath, config, errors);
  validateWorkspaceAliases(raw.workspaceAliases, config, errors);

  return { config, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateComponents(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    errors.push("'components' must be an array");
    return;
  }

  const components: NonNullable<ReleaseKitConfig['components']> = [];
  for (const [i, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`components[${i}]: must be an object`);
      continue;
    }
    if (typeof entry.dir !== 'string' || entry.dir === '') {
      errors.push(`components[${i}]: 'dir' is required`);
      continue;
    }

    const component: NonNullable<ReleaseKitConfig['components']>[number] = { dir: entry.dir };

    if (entry.tagPrefix !== undefined) {
      if (typeof entry.tagPrefix === 'string') {
        component.tagPrefix = entry.tagPrefix;
      } else {
        errors.push(`components[${i}]: 'tagPrefix' must be a string`);
      }
    }
    if (entry.shouldExclude !== undefined) {
      if (typeof entry.shouldExclude === 'boolean') {
        component.shouldExclude = entry.shouldExclude;
      } else {
        errors.push(`components[${i}]: 'shouldExclude' must be a boolean`);
      }
    }
    components.push(component);
  }
  config.components = components;
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

function validateWorkspaceAliases(value: unknown, config: ReleaseKitConfig, errors: string[]): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    errors.push("'workspaceAliases' must be a record (object)");
    return;
  }

  const aliases: Record<string, string> = {};
  let valid = true;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      aliases[key] = v;
    } else {
      errors.push(`workspaceAliases.${key}: value must be a string`);
      valid = false;
    }
  }
  // All-or-nothing: only assign aliases when every entry is valid.
  // Unlike `validateComponents`, partial results are not useful for aliases
  // because the mapping is consumed as a complete lookup table.
  if (valid) {
    config.workspaceAliases = aliases;
  }
}
