import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WORK_TYPES_DATA } from '../defaults.ts';
import { isRecord } from '../typeGuards.ts';

const ALLOWED_BREAKING_POLICIES = new Set(['forbidden', 'optional', 'required']);

const thisDir = dirname(fileURLToPath(import.meta.url));
const workTypesJsonPath = resolve(thisDir, '..', 'work-types.json');

describe('work-types.json mirrors workTypesData.ts (drift detection)', () => {
  it('the TS mirror deep-equals the JSON canonical, apart from its `$schema` hint', () => {
    expect(WORK_TYPES_DATA).toStrictEqual(readJsonWithoutSchemaHint());
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

  it('contains exactly the canonical 15 entries (6 public, 3 internal, 6 process including fmt)', () => {
    expect(WORK_TYPES_DATA.types).toHaveLength(15);
    const tierCounts = new Map<string, number>();
    for (const entry of WORK_TYPES_DATA.types) {
      tierCounts.set(entry.tier, (tierCounts.get(entry.tier) ?? 0) + 1);
    }
    expect(tierCounts.get('public')).toBe(6);
    expect(tierCounts.get('internal')).toBe(3);
    // `fmt` is in the `process` tier (canonical count is 6); the implementation plan listed it
    // separately as "5 process plus fmt" to emphasize its `excludedFromChangelog` flag.
    expect(tierCounts.get('process')).toBe(6);
  });

  it('every entry has a non-empty `label` and `emoji`', () => {
    for (const entry of WORK_TYPES_DATA.types) {
      expect(!!entry.label, `entry "${entry.key}" has an empty label`).toBe(true);
      expect(!!entry.emoji, `entry "${entry.key}" has an empty emoji`).toBe(true);
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

  it('orders entries by tier (public → internal → process), then by row within tier', () => {
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

// region | Helpers
/** Reads `work-types.json` and drops the local-only `$schema` IDE hint, which the TS mirror does not carry. */
function readJsonWithoutSchemaHint(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(workTypesJsonPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`work-types.json at ${workTypesJsonPath} is not a JSON object`);
  }
  const data = { ...parsed };
  delete data['$schema'];
  return data;
}
// endregion | Helpers
