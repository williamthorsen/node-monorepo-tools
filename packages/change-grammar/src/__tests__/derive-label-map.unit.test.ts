import { describe, expect, it } from 'vitest';

import { deriveLabelMap } from '../derive-label-map.ts';
import { CANONICAL_TAXONOMY } from '../taxonomy.ts';

/** codeassembly's hardcoded `TYPE_MAP`, which the canonical taxonomy's tracker labels replace. */
const CODEASSEMBLY_TYPE_MAP = {
  ai: 'ai',
  ci: 'ci',
  deprecate: 'deprecation',
  deps: 'dependencies',
  docs: 'documentation',
  drop: 'removal',
  feat: 'feature',
  fix: 'fix',
  fmt: 'formatting',
  internal: 'internal',
  perf: 'performance',
  refactor: 'refactoring',
  sec: 'security',
  tests: 'tests',
  tooling: 'tooling',
};

describe(deriveLabelMap, () => {
  it("maps the canonical taxonomy's types to codeassembly's tracker labels", () => {
    expect(deriveLabelMap(CANONICAL_TAXONOMY, []).types).toStrictEqual(CODEASSEMBLY_TYPE_MAP);
  });

  it('maps each workspace to its scope label and adds root after them', () => {
    const { scopes } = deriveLabelMap(CANONICAL_TAXONOMY, ['nmr', 'change-grammar']);

    expect(Object.entries(scopes)).toStrictEqual([
      ['nmr', 'scope:nmr'],
      ['change-grammar', 'scope:change-grammar'],
      ['root', 'scope:root'],
    ]);
  });

  it('derives no scopes, not even root, for an empty workspace list', () => {
    expect(deriveLabelMap(CANONICAL_TAXONOMY, []).scopes).toStrictEqual({});
  });

  it('keeps the order of the given types', () => {
    const taxonomy = {
      types: [
        { key: 'zeta', trackerLabel: 'z' },
        { key: 'alpha', trackerLabel: 'a' },
      ],
    };

    expect(Object.keys(deriveLabelMap(taxonomy, []).types)).toStrictEqual(['zeta', 'alpha']);
  });
});
