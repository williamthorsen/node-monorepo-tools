import { describe, expect, it } from 'vitest';

import { assertIsPreflightCollection } from '../src/assertIsPreflightCollection.ts';

describe(assertIsPreflightCollection, () => {
  it('throws when input is not an object', () => {
    expect(() => assertIsPreflightCollection('string')).toThrow('Preflight collection must be an object, got string');
  });

  it('throws when input is an array', () => {
    expect(() => assertIsPreflightCollection([])).toThrow('Preflight collection must be an object, got array');
  });

  it('throws when checklists is missing', () => {
    expect(() => assertIsPreflightCollection({})).toThrow("must have a 'checklists' array");
  });

  it('throws when a checklist has neither checks nor groups', () => {
    expect(() => assertIsPreflightCollection({ checklists: [{ name: 'bad' }] })).toThrow(
      "must have either 'checks' or 'groups'",
    );
  });

  it('throws when a checklist has both checks and groups', () => {
    expect(() => assertIsPreflightCollection({ checklists: [{ name: 'bad', checks: [], groups: [] }] })).toThrow(
      "cannot have both 'checks' and 'groups'",
    );
  });

  it('throws when a checklist entry is not an object', () => {
    expect(() => assertIsPreflightCollection({ checklists: ['not-an-object'] })).toThrow(
      'checklists[0]: must be an object',
    );
  });

  it('throws when a checklist name is missing', () => {
    expect(() => assertIsPreflightCollection({ checklists: [{ checks: [] }] })).toThrow(
      "checklists[0]: 'name' is required and must be a non-empty string",
    );
  });

  it('accepts a valid collection with flat checklists', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
      }),
    ).not.toThrow();
  });

  it('accepts a valid collection with staged checklists', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', groups: [[{ name: 'a', check: () => true }]] }],
      }),
    ).not.toThrow();
  });
});
