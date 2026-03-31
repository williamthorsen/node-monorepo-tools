import { describe, expect, it } from 'vitest';

import { assertIsPreflightConfig } from '../src/assertIsPreflightConfig.ts';

describe(assertIsPreflightConfig, () => {
  it('throws when input is not an object', () => {
    expect(() => assertIsPreflightConfig('string')).toThrow('Preflight config must be an object, got string');
  });

  it('throws when input is an array', () => {
    expect(() => assertIsPreflightConfig([])).toThrow('Preflight config must be an object, got array');
  });

  it('throws when checklists is missing', () => {
    expect(() => assertIsPreflightConfig({})).toThrow("must have a 'checklists' array");
  });

  it('throws when a checklist has neither checks nor groups', () => {
    expect(() => assertIsPreflightConfig({ checklists: [{ name: 'bad' }] })).toThrow(
      "must have either 'checks' or 'groups'",
    );
  });

  it('throws when a checklist has both checks and groups', () => {
    expect(() => assertIsPreflightConfig({ checklists: [{ name: 'bad', checks: [], groups: [] }] })).toThrow(
      "cannot have both 'checks' and 'groups'",
    );
  });

  it('throws when a checklist entry is not an object', () => {
    expect(() => assertIsPreflightConfig({ checklists: ['not-an-object'] })).toThrow(
      'checklists[0]: must be an object',
    );
  });

  it('throws when a checklist name is missing', () => {
    expect(() => assertIsPreflightConfig({ checklists: [{ checks: [] }] })).toThrow(
      "checklists[0]: 'name' is required and must be a non-empty string",
    );
  });

  it('accepts a valid config with flat checklists', () => {
    expect(() =>
      assertIsPreflightConfig({
        checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
      }),
    ).not.toThrow();
  });

  it('accepts a valid config with staged checklists', () => {
    expect(() =>
      assertIsPreflightConfig({
        checklists: [{ name: 'test', groups: [[{ name: 'a', check: () => true }]] }],
      }),
    ).not.toThrow();
  });
});
