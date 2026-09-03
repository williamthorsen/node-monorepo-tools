import { describe, expect, it } from 'vitest';

import { extractMigration } from '../extractMigration.ts';

describe(extractMigration, () => {
  it('returns undefined when the body is absent', () => {
    expect(extractMigration(undefined)).toBeUndefined();
  });

  it('returns undefined when no paragraph carries the label', () => {
    expect(extractMigration('Adds a widget.\n\nSeparately, renames the helper.')).toBeUndefined();
  });

  it('returns the instruction with the label stripped', () => {
    const body = 'Adds a widget.\n\nMigration: Change any uses of `oldName` to `newName`.';

    expect(extractMigration(body)).toBe('Change any uses of `oldName` to `newName`.');
  });

  it('extracts the paragraph wherever it sits in the body', () => {
    const body = 'Adds a widget.\n\nMigration: Quote every version number.\n\nSeparately, drops the shim.';

    expect(extractMigration(body)).toBe('Quote every version number.');
  });

  it('finds the paragraph after a run of blank lines', () => {
    const body = 'Adds a widget.\n\n\nMigration: Quote every version number.';

    expect(extractMigration(body)).toBe('Quote every version number.');
  });

  it('takes the first labeled paragraph when the body carries two', () => {
    const body = 'Migration: Quote every version number.\n\nMigration: Also rename the field.';

    expect(extractMigration(body)).toBe('Quote every version number.');
  });

  it('preserves newlines inside a multi-line paragraph', () => {
    const body = 'Migration: Quote every version number.\nRename the field to `version`.';

    expect(extractMigration(body)).toBe('Quote every version number.\nRename the field to `version`.');
  });

  it('capitalizes a lowercase continuation', () => {
    const body = 'Migration: consumers of `audit` need a `packageManager` field.';

    expect(extractMigration(body)).toBe('Consumers of `audit` need a `packageManager` field.');
  });

  it('ignores a label that does not open the paragraph', () => {
    const body = 'The paragraph below explains it. Migration: this one is mid-paragraph.';

    expect(extractMigration(body)).toBeUndefined();
  });

  it('ignores a label whose case or emphasis differs', () => {
    expect(extractMigration('migration: quote the version numbers.')).toBeUndefined();
    expect(extractMigration('**Migration:** Quote the version numbers.')).toBeUndefined();
  });

  it('returns undefined when the label is followed by nothing', () => {
    expect(extractMigration('Adds a widget.\n\nMigration:')).toBeUndefined();
    expect(extractMigration('Adds a widget.\n\nMigration:   ')).toBeUndefined();
  });
});
