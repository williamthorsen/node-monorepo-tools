import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { assertIsPreflightCollection } from '../src/assertIsPreflightCollection.ts';

describe(assertIsPreflightCollection, () => {
  it('throws when input is not an object', () => {
    expect(() => assertIsPreflightCollection('string')).toThrow(ZodError);
  });

  it('throws when input is an array', () => {
    expect(() => assertIsPreflightCollection([])).toThrow(ZodError);
  });

  it('throws when checklists is missing', () => {
    expect(() => assertIsPreflightCollection({})).toThrow(ZodError);
  });

  it('throws when a checklist has neither checks nor groups', () => {
    expect(() => assertIsPreflightCollection({ checklists: [{ name: 'bad' }] })).toThrow(ZodError);
  });

  it('throws when a checklist has both checks and groups', () => {
    try {
      assertIsPreflightCollection({ checklists: [{ name: 'bad', checks: [], groups: [] }] });
      expect.unreachable('Expected ZodError');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Checklist cannot have both 'checks' and 'groups'" }),
        ]),
      );
    }
  });

  it('throws when a checklist entry is not an object', () => {
    try {
      assertIsPreflightCollection({ checklists: ['not-an-object'] });
      expect.unreachable('Expected ZodError');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      expect(error.issues[0]?.path).toEqual(expect.arrayContaining(['checklists', 0]));
    }
  });

  it('throws when a checklist name is missing', () => {
    try {
      assertIsPreflightCollection({ checklists: [{ checks: [] }] });
      expect.unreachable('Expected ZodError');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const nameIssue = error.issues
        .flatMap((i) => ('errors' in i ? i.errors.flat() : [i]))
        .find((i) => i.path.includes('name'));
      expect(nameIssue).toBeDefined();
    }
  });

  it('throws when a checklist name is empty', () => {
    try {
      assertIsPreflightCollection({ checklists: [{ name: '', checks: [] }] });
      expect.unreachable('Expected ZodError');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const nameIssue = error.issues
        .flatMap((i) => ('errors' in i ? i.errors.flat() : [i]))
        .find((i) => i.path.includes('name'));
      expect(nameIssue).toBeDefined();
    }
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

  it('accepts a valid collection with suites', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'lint', checks: [] }],
        suites: { ci: ['lint'] },
      }),
    ).not.toThrow();
  });

  it('accepts a collection without suites', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
      }),
    ).not.toThrow();
  });

  it('throws when suites is not an object', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
        suites: 'not-a-record',
      }),
    ).toThrow(ZodError);
  });

  it('throws when a suite value is not an array', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
        suites: { ci: 'not-an-array' },
      }),
    ).toThrow(ZodError);
  });

  it('throws when a suite contains non-string entries', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
        suites: { ci: [42] },
      }),
    ).toThrow(ZodError);
  });

  it('accepts a valid fixLocation', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
        fixLocation: 'INLINE',
      }),
    ).not.toThrow();
  });

  it('throws when fixLocation is invalid', () => {
    expect(() =>
      assertIsPreflightCollection({
        checklists: [{ name: 'test', checks: [] }],
        fixLocation: 'WRONG',
      }),
    ).toThrow(ZodError);
  });
});
