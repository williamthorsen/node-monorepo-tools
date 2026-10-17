import { existsSync, readFileSync } from 'node:fs';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { isRecord } from './typeGuards.ts';
import type { ChangelogOverride } from './types.ts';

/** Allowed audience values declared in the on-disk override format (full forward-compatible vocabulary). */
const VALID_AUDIENCE_VALUES = new Set(['all', 'dev', 'skip']);

/** The audience values that the applier supports; the format reserves `'all'` and `'dev'` for reclassification. */
const V1_SUPPORTED_AUDIENCE_VALUES = new Set(['skip']);

/** Top-level key that names the file's JSON Schema for editor support; not an override. */
const SCHEMA_KEY = '$schema';

/** Known fields on a single override entry; presence of any other field is a validation error. */
export const KNOWN_OVERRIDE_FIELDS = new Set(['audience', 'description', 'body', 'breaking']);

/**
 * Loads and validates the editorial overrides file at `path`. A missing file yields an empty map; an unreadable file,
 * malformed JSON, a wrong top-level shape, or any per-entry validation failure yields errors.
 */
export function loadChangelogOverrides(path: string): LoadChangelogOverridesResult {
  if (!existsSync(path)) {
    return { overrides: new Map() };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    return {
      errors: [`Failed to read override file ${path}: ${describeError(error)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    return {
      errors: [`Failed to parse override file ${path}: ${describeError(error)}`],
    };
  }

  const result = validateChangelogOverrides(parsed);
  if (result.errors.length > 0) {
    return { errors: result.errors };
  }
  return { overrides: result.overrides };
}

/** Result of loading an override file: either parsed overrides or a list of structured errors. */
export type LoadChangelogOverridesResult = { overrides: Map<string, ChangelogOverride> } | { errors: string[] };

/** Form of an override key: a lowercase hex commit hash or prefix, optionally followed by `:<n>`, a 1-based entry position. */
export const OVERRIDE_KEY_PATTERN = /^[0-9a-f]+(:[1-9][0-9]*)?$/;

/** Splits a valid override key into its hash prefix and, for an ordinal key, its 1-based entry position. */
export function parseOverrideKey(key: string): { hashPrefix: string; entry?: number } {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex === -1) {
    return { hashPrefix: key };
  }
  return { hashPrefix: key.slice(0, separatorIndex), entry: Number(key.slice(separatorIndex + 1)) };
}

/**
 * Validates a parsed override record, returning the valid overrides and an error message for each problem.
 *
 * Each error names the offending key (e.g. `overrides['abc']: 'audience' must be one of …`) so that the user can find
 * it in the override file.
 */
export function validateChangelogOverrides(raw: unknown): {
  overrides: Map<string, ChangelogOverride>;
  errors: string[];
} {
  const overrides = new Map<string, ChangelogOverride>();
  const errors: string[] = [];

  if (!isRecord(raw)) {
    errors.push('Override file: top-level value must be an object keyed by commit hash');
    return { overrides, errors };
  }

  for (const [key, rawEntry] of Object.entries(raw)) {
    if (key === SCHEMA_KEY) {
      if (typeof rawEntry !== 'string') {
        errors.push(`Override file: '${SCHEMA_KEY}' must be a string`);
      }
      continue;
    }
    if (!OVERRIDE_KEY_PATTERN.test(key)) {
      errors.push(
        `overrides['${key}']: key must be a lowercase hex commit hash or prefix, optionally followed by ':<n>'`,
      );
      continue;
    }
    const validated = validateSingleOverride(key, rawEntry, errors);
    if (validated !== undefined) {
      overrides.set(key, validated);
    }
  }

  return { overrides, errors };
}

// region | Helpers

/**
 * Validates the `audience` field. The format declares `'all' | 'dev' | 'skip'` so that reclassification doesn't need
 * a schema change, but only `'skip'` is supported; `'all'` and `'dev'` are rejected as not yet supported.
 */
function validateAudience(key: string, value: unknown, errors: string[]): 'skip' | undefined {
  if (typeof value !== 'string' || !VALID_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: 'audience' must be one of 'all' | 'dev' | 'skip'`);
    return undefined;
  }
  if (!V1_SUPPORTED_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: audience '${value}' is not yet supported; only 'skip' is currently accepted`);
    return undefined;
  }
  return 'skip';
}

/** Validates the override entry for `key`, returning it, or undefined after pushing one or more errors. */
function validateSingleOverride(key: string, rawEntry: unknown, errors: string[]): ChangelogOverride | undefined {
  if (!isRecord(rawEntry)) {
    errors.push(`overrides['${key}']: must be an object`);
    return undefined;
  }

  let entryValid = true;
  for (const fieldName of Object.keys(rawEntry)) {
    if (KNOWN_OVERRIDE_FIELDS.has(fieldName)) {
      continue;
    }

    errors.push(`overrides['${key}']: unknown field '${fieldName}'`);
    entryValid = false;
  }

  const result: ChangelogOverride = {};
  if (rawEntry['audience'] !== undefined) {
    const audienceResult = validateAudience(key, rawEntry['audience'], errors);
    if (audienceResult === undefined) {
      entryValid = false;
    } else {
      result.audience = audienceResult;
    }
  }

  if (rawEntry['description'] !== undefined) {
    if (typeof rawEntry['description'] !== 'string') {
      errors.push(`overrides['${key}']: 'description' must be a string`);
      entryValid = false;
    } else {
      result.description = rawEntry['description'];
    }
  }

  if (rawEntry['body'] !== undefined) {
    if (typeof rawEntry['body'] !== 'string') {
      errors.push(`overrides['${key}']: 'body' must be a string`);
      entryValid = false;
    } else {
      result.body = rawEntry['body'];
    }
  }

  if (rawEntry['breaking'] !== undefined) {
    if (typeof rawEntry['breaking'] !== 'boolean') {
      errors.push(`overrides['${key}']: 'breaking' must be a boolean`);
      entryValid = false;
    } else {
      result.breaking = rawEntry['breaking'];
    }
  }

  if (Object.keys(result).length === 0 && entryValid) {
    errors.push(`overrides['${key}']: at least one override field must be set`);
    return undefined;
  }

  if (!entryValid) {
    return undefined;
  }
  return result;
}

// endregion | Helpers
