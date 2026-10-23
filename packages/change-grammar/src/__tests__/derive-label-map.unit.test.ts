import { describe, expect, it } from 'vitest';

import { deriveLabelMap } from '../derive-label-map.ts';
import { CANONICAL_TAXONOMY } from '../taxonomy.ts';

/** A copy of codeassembly's `TYPE_MAP`, the labels that its trackers already apply. */
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
    expect(deriveLabelMap(CANONICAL_TAXONOMY, [], { isMonorepo: false }).types).toStrictEqual(CODEASSEMBLY_TYPE_MAP);
  });

  it('maps each workspace to its scope label and adds root after them for a monorepo', () => {
    const { scopes } = deriveLabelMap(CANONICAL_TAXONOMY, ['nmr', 'change-grammar'], { isMonorepo: true });

    expect(Object.entries(scopes)).toStrictEqual([
      ['nmr', 'scope:nmr'],
      ['change-grammar', 'scope:change-grammar'],
      ['root', 'scope:root'],
    ]);
  });

  it('derives root alone for a monorepo without workspaces', () => {
    expect(deriveLabelMap(CANONICAL_TAXONOMY, [], { isMonorepo: true }).scopes).toStrictEqual({ root: 'scope:root' });
  });

  it('omits root when the repo is not a monorepo', () => {
    const { scopes } = deriveLabelMap(CANONICAL_TAXONOMY, ['nmr'], { isMonorepo: false });

    expect(scopes).toStrictEqual({ nmr: 'scope:nmr' });
  });

  it('keeps the order of the given types', () => {
    const taxonomy = {
      types: [
        { key: 'zeta', trackerLabel: 'z' },
        { key: 'alpha', trackerLabel: 'a' },
      ],
    };

    expect(Object.keys(deriveLabelMap(taxonomy, [], { isMonorepo: false }).types)).toStrictEqual(['zeta', 'alpha']);
  });
});
