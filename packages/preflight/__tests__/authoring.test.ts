import { describe, expect, it } from 'vitest';

import {
  defineChecklists,
  definePreflightChecklist,
  definePreflightCollection,
  definePreflightConfig,
  definePreflightStagedChecklist,
} from '../src/authoring.ts';

describe(defineChecklists, () => {
  it('returns its input unchanged', () => {
    const checklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];

    expect(defineChecklists(checklists)).toBe(checklists);
  });
});

describe(definePreflightConfig, () => {
  it('returns its input unchanged', () => {
    const config = {
      compile: { srcDir: '.preflight/collections', outDir: '.preflight/collections' },
    };

    expect(definePreflightConfig(config)).toBe(config);
  });
});

describe(definePreflightCollection, () => {
  it('returns its input unchanged', () => {
    const collection = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };

    expect(definePreflightCollection(collection)).toBe(collection);
  });
});

describe(definePreflightChecklist, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', checks: [{ name: 'a', check: () => true }] };

    expect(definePreflightChecklist(checklist)).toBe(checklist);
  });
});

describe(definePreflightStagedChecklist, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', groups: [[{ name: 'a', check: () => true }]] };

    expect(definePreflightStagedChecklist(checklist)).toBe(checklist);
  });
});
