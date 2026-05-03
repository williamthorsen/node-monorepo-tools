import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WORK_TYPES_DATA } from '../defaults.ts';

const ALLOWED_BREAKING_POLICIES = new Set(['forbidden', 'optional', 'required']);

const thisDir = dirname(fileURLToPath(import.meta.url));
const workTypesJsonPath = resolve(thisDir, '..', 'work-types.json');

interface WorkTypesJsonData {
  $schema?: string;
  tiers: string[];
  types: Array<{
    tier: string;
    key: string;
    aliases: string[];
    emoji: string;
    label: string;
    breakingPolicy: string;
    excludedFromChangelog?: boolean;
  }>;
}

function readJsonFile(): WorkTypesJsonData {
  const content = readFileSync(workTypesJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(content);
  if (!isWorkTypesJsonData(parsed)) {
    throw new Error(`work-types.json at ${workTypesJsonPath} does not match expected shape`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string');
}

function isWorkTypesJsonData(value: unknown): value is WorkTypesJsonData {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.tiers)) return false;
  if (!Array.isArray(value.types) || !value.types.every(isWorkTypesEntry)) return false;
  return true;
}

function isWorkTypesEntry(value: unknown): value is WorkTypesJsonData['types'][number] {
  if (!isRecord(value)) return false;
  if (
    typeof value.tier !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.emoji !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.breakingPolicy !== 'string'
  ) {
    return false;
  }
  if (!isStringArray(value.aliases)) return false;
  if (value.excludedFromChangelog !== undefined && typeof value.excludedFromChangelog !== 'boolean') {
    return false;
  }
  return true;
}

describe('work-types.json mirrors workTypesData.ts (drift detection)', () => {
  it('the TS mirror has the same `tiers` as the JSON canonical', () => {
    const json = readJsonFile();
    expect(WORK_TYPES_DATA.tiers).toStrictEqual(json.tiers);
  });

  it('the TS mirror has the same number of `types` as the JSON canonical', () => {
    const json = readJsonFile();
    expect(WORK_TYPES_DATA.types).toHaveLength(json.types.length);
  });

  it('every JSON entry deep-equals its TS counterpart at the same index', () => {
    const json = readJsonFile();
    for (const [index, jsonEntry] of json.types.entries()) {
      const tsEntry = WORK_TYPES_DATA.types[index];
      expect(tsEntry, `index ${index} (${jsonEntry.key}) missing in TS mirror`).toBeDefined();
      // Compare field-by-field; `excludedFromChangelog` is optional, others are required.
      expect(tsEntry?.tier).toBe(jsonEntry.tier);
      expect(tsEntry?.key).toBe(jsonEntry.key);
      expect(tsEntry?.aliases).toStrictEqual(jsonEntry.aliases);
      expect(tsEntry?.emoji).toBe(jsonEntry.emoji);
      expect(tsEntry?.label).toBe(jsonEntry.label);
      expect(tsEntry?.breakingPolicy).toBe(jsonEntry.breakingPolicy);
      expect(tsEntry?.excludedFromChangelog).toBe(jsonEntry.excludedFromChangelog);
    }
  });
});

describe('work-types.json structural invariants', () => {
  it('exposes a non-empty `tiers` array', () => {
    expect(Array.isArray(WORK_TYPES_DATA.tiers)).toBe(true);
    expect(WORK_TYPES_DATA.tiers.length).toBeGreaterThan(0);
  });

  it('exposes a non-empty `types` array', () => {
    expect(Array.isArray(WORK_TYPES_DATA.types)).toBe(true);
    expect(WORK_TYPES_DATA.types.length).toBeGreaterThan(0);
  });

  it('contains exactly the canonical 15 entries (6 Public, 3 Internal, 6 Process including fmt)', () => {
    expect(WORK_TYPES_DATA.types).toHaveLength(15);
    const tierCounts = new Map<string, number>();
    for (const entry of WORK_TYPES_DATA.types) {
      tierCounts.set(entry.tier, (tierCounts.get(entry.tier) ?? 0) + 1);
    }
    expect(tierCounts.get('Public')).toBe(6);
    expect(tierCounts.get('Internal')).toBe(3);
    expect(tierCounts.get('Process')).toBe(6);
  });

  it('every entry has a non-empty `label` and `emoji`', () => {
    for (const entry of WORK_TYPES_DATA.types) {
      expect(entry.label, `entry "${entry.key}" has an empty label`).toBeTruthy();
      expect(entry.emoji, `entry "${entry.key}" has an empty emoji`).toBeTruthy();
    }
  });

  it('every entry references a `tier` that exists in the top-level `tiers` array', () => {
    const knownTiers = new Set(WORK_TYPES_DATA.tiers);
    for (const entry of WORK_TYPES_DATA.types) {
      expect(knownTiers.has(entry.tier), `entry "${entry.key}" tier "${entry.tier}" not in tiers array`).toBe(true);
    }
  });

  it('every entry has a `breakingPolicy` from the allowed enum', () => {
    for (const entry of WORK_TYPES_DATA.types) {
      expect(
        ALLOWED_BREAKING_POLICIES.has(entry.breakingPolicy),
        `entry "${entry.key}" has invalid breakingPolicy "${entry.breakingPolicy}"`,
      ).toBe(true);
    }
  });

  it('all keys are globally unique', () => {
    const keys = WORK_TYPES_DATA.types.map((entry) => entry.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('all aliases are globally unique', () => {
    const aliases: string[] = [];
    for (const entry of WORK_TYPES_DATA.types) {
      aliases.push(...entry.aliases);
    }
    const uniqueAliases = new Set(aliases);
    expect(uniqueAliases.size).toBe(aliases.length);
  });

  it('aliases do not collide with any key', () => {
    const keys = new Set(WORK_TYPES_DATA.types.map((entry) => entry.key));
    for (const entry of WORK_TYPES_DATA.types) {
      for (const alias of entry.aliases) {
        expect(keys.has(alias), `alias "${alias}" of "${entry.key}" collides with another entry's key`).toBe(false);
      }
    }
  });

  it('orders entries by tier (Public → Internal → Process), then by row within tier', () => {
    const tierOrder = new Map(WORK_TYPES_DATA.tiers.map((tier, index) => [tier, index]));
    let previousTierIndex = -1;
    for (const entry of WORK_TYPES_DATA.types) {
      const currentTierIndex = tierOrder.get(entry.tier);
      expect(currentTierIndex).toBeDefined();
      if (currentTierIndex === undefined) continue;
      expect(currentTierIndex).toBeGreaterThanOrEqual(previousTierIndex);
      previousTierIndex = currentTierIndex;
    }
  });

  it('places `fmt` last with `excludedFromChangelog: true`', () => {
    const lastEntry = WORK_TYPES_DATA.types.at(-1);
    expect(lastEntry?.key).toBe('fmt');
    expect(lastEntry?.excludedFromChangelog).toBe(true);
  });

  it('marks `drop` with `breakingPolicy: "required"` as the only required entry', () => {
    const requiredEntries = WORK_TYPES_DATA.types.filter((entry) => entry.breakingPolicy === 'required');
    expect(requiredEntries).toHaveLength(1);
    expect(requiredEntries[0]?.key).toBe('drop');
  });

  it('wires `utility` as an alias of `internal`', () => {
    const internalEntry = WORK_TYPES_DATA.types.find((entry) => entry.key === 'internal');
    expect(internalEntry?.aliases).toContain('utility');
  });
});
