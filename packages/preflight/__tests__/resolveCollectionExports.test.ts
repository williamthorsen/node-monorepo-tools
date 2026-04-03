import { describe, expect, it } from 'vitest';

import { resolveCollectionExports } from '../src/resolveCollectionExports.ts';

describe(resolveCollectionExports, () => {
  it('extracts checklists from a module with named exports', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const result = resolveCollectionExports({ checklists });

    expect(result).toStrictEqual({ checklists });
  });

  it('unwraps checklists from a default export', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const result = resolveCollectionExports({ default: { checklists } });

    expect(result).toStrictEqual({ checklists });
  });

  it('forwards fixLocation when defined', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const result = resolveCollectionExports({ checklists, fixLocation: 'inline' });

    expect(result).toStrictEqual({ checklists, fixLocation: 'inline' });
  });

  it('omits fixLocation when undefined', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const result = resolveCollectionExports({ checklists });

    expect(result).not.toHaveProperty('fixLocation');
  });

  it('forwards suites when defined', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const suites = { ci: ['a'] };
    const result = resolveCollectionExports({ checklists, suites });

    expect(result).toStrictEqual({ checklists, suites });
  });

  it('omits suites when undefined', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const result = resolveCollectionExports({ checklists });

    expect(result).not.toHaveProperty('suites');
  });

  it('forwards both fixLocation and suites from a default export', () => {
    const checklists = [{ name: 'a', checks: [] }];
    const suites = { ci: ['a'] };
    const result = resolveCollectionExports({ default: { checklists, fixLocation: 'end', suites } });

    expect(result).toStrictEqual({ checklists, fixLocation: 'end', suites });
  });

  it('throws when checklists is missing', () => {
    expect(() => resolveCollectionExports({ other: 'value' })).toThrow('must export checklists');
  });
});
