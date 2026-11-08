import { describe, expect, it } from 'vitest';

import { collectChangedPaths } from '../collectChangedPaths.ts';

// The fixed fields that precede the path in each record type, in git's documented `--porcelain=v2` layout.
const ORDINARY_FIELDS = '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb';
const RENAME_FIELDS = '2 R. N... 100644 100644 100644 aaaaaaa aaaaaaa R100';
const UNMERGED_FIELDS = 'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc';

describe(collectChangedPaths, () => {
  it('skips header records and collects the paths of the records that follow', () => {
    const output = buildStatusOutput('# branch.oid abc123', '# branch.head main', `${ORDINARY_FIELDS} src/index.ts`);

    expect(collectChangedPaths(output)).toStrictEqual({ ok: true, paths: new Set(['src/index.ts']) });
  });

  it('keeps a path that contains spaces intact', () => {
    const output = buildStatusOutput(`${ORDINARY_FIELDS} docs/release notes.md`);

    expect(collectChangedPaths(output)).toStrictEqual({ ok: true, paths: new Set(['docs/release notes.md']) });
  });

  it('collects both the new and the original path of a rename', () => {
    const output = buildStatusOutput(`${RENAME_FIELDS} src/new name.ts`, 'src/old name.ts');

    expect(collectChangedPaths(output)).toStrictEqual({
      ok: true,
      paths: new Set(['src/new name.ts', 'src/old name.ts']),
    });
  });

  it('collects untracked and unmerged paths', () => {
    const output = buildStatusOutput('? notes/todo.md', `${UNMERGED_FIELDS} src/conflict.ts`);

    expect(collectChangedPaths(output)).toStrictEqual({
      ok: true,
      paths: new Set(['notes/todo.md', 'src/conflict.ts']),
    });
  });

  it('accepts an untracked path that starts with "S"', () => {
    // An untracked record does not have a submodule field, so its path is not read as one.
    const output = buildStatusOutput('? Scratch.md');

    expect(collectChangedPaths(output)).toStrictEqual({ ok: true, paths: new Set(['Scratch.md']) });
  });

  it('refuses a submodule record', () => {
    const output = buildStatusOutput('1 .M S.M. 160000 160000 160000 aaaaaaa bbbbbbb vendor');

    expect(collectChangedPaths(output)).toStrictEqual({ ok: false, reason: expect.stringContaining('submodule') });
  });

  it('refuses a record type that it does not recognize', () => {
    const output = buildStatusOutput('! dist/bundle.js');

    expect(collectChangedPaths(output)).toStrictEqual({ ok: false, reason: expect.stringContaining('unrecognized') });
  });

  it('refuses a record that ends before its path', () => {
    const output = buildStatusOutput('1 .M');

    expect(collectChangedPaths(output)).toStrictEqual({ ok: false, reason: expect.stringContaining('malformed') });
  });

  it('refuses a record whose path is empty', () => {
    const output = buildStatusOutput('? ');

    expect(collectChangedPaths(output)).toStrictEqual({ ok: false, reason: expect.stringContaining('malformed') });
  });

  it('refuses a rename without an original path', () => {
    const output = buildStatusOutput(`${RENAME_FIELDS} src/new.ts`);

    expect(collectChangedPaths(output)).toStrictEqual({
      ok: false,
      reason: expect.stringContaining('rename without an original path'),
    });
  });
});

// region | Helpers

/** Joins records as `git status --porcelain=v2 -z` does, each terminated by a NUL. */
function buildStatusOutput(...records: string[]): string {
  return records.map((record) => `${record}\0`).join('');
}

// endregion | Helpers
