import { describe, expect, it } from 'vitest';

import type { RawCommit } from '../enumerateReleaseWindows.ts';
import { findUnroutedEntryScopes, type WorkspaceWindow } from '../findUnroutedEntryScopes.ts';

const SUBJECT = '#859 release-kit|feat: Route entries (#43)';
const CONFIGURED = ['arrays', 'strings', 'numbers'];

describe(findUnroutedEntryScopes, () => {
  it('reports a scope naming a workspace outside the window and one naming nothing, under every window', () => {
    const commit = blockCommit('a1', [['arrays'], ['numbers'], ['nothing']]);

    const findings = findUnroutedEntryScopes(
      [window('arrays', [commit]), window('strings', [commit]), window('numbers', [])],
      CONFIGURED,
      {},
    );

    const expected = [
      { commitHash: 'a1', commitSubject: SUBJECT, entryPosition: 2, scope: 'numbers' },
      { commitHash: 'a1', commitSubject: SUBJECT, entryPosition: 3, scope: 'nothing' },
    ];
    expect(findings.get('arrays')).toStrictEqual(expected);
    expect(findings.get('strings')).toStrictEqual(expected);
    expect(findings.has('numbers')).toBe(false);
  });

  it.each([
    ['`root`', ['root']],
    ['`*`', ['*']],
    ['an in-window scope', ['arrays']],
    ['an empty scope list', []],
  ])('does not report %s', (_label, scopes) => {
    const commit = blockCommit('a1', [scopes]);

    expect(findUnroutedEntryScopes([window('arrays', [commit])], CONFIGURED, {}).size).toBe(0);
  });

  it('does not report a configured workspace that the run did not read', () => {
    const commit = blockCommit('a1', [['strings']]);

    expect(findUnroutedEntryScopes([window('arrays', [commit])], CONFIGURED, {}).size).toBe(0);
  });

  it('reports `root` as an out-of-window workspace when a workspace has that dir', () => {
    const commit = blockCommit('a1', [['root']]);

    const findings = findUnroutedEntryScopes([window('arrays', [commit]), window('root', [])], ['arrays', 'root'], {});

    expect(findings.get('arrays')?.map((finding) => finding.scope)).toStrictEqual(['root']);
  });

  it('resolves a scope through the aliases before the check, reporting the declared scope', () => {
    const commit = blockCommit('a1', [['arr'], ['str']]);

    const findings = findUnroutedEntryScopes([window('arrays', [commit]), window('strings', [])], CONFIGURED, {
      arr: 'arrays',
      str: 'strings',
    });

    expect(findings.get('arrays')?.map((finding) => finding.scope)).toStrictEqual(['str']);
  });

  it('reports a scope that an entry repeats once', () => {
    const commit = blockCommit('a1', [['nothing', 'nothing']]);

    expect(findUnroutedEntryScopes([window('arrays', [commit])], CONFIGURED, {}).get('arrays')).toHaveLength(1);
  });

  it.each([
    ['a merge commit', makeCommit('a1', "Merge branch 'feat'", blockPayload([['nothing']]))],
    ['a malformed block', makeCommit('a1', SUBJECT, ['```change-record', 'entries: 3', '```'].join('\n'))],
    ['a block with no entries', makeCommit('a1', SUBJECT, ['```change-record', 'entries: []', '```'].join('\n'))],
    ['a commit with no block', makeCommit('a1', '#1 feat: Add', '')],
  ])('skips %s', (_label, commit) => {
    expect(findUnroutedEntryScopes([window('arrays', [commit])], CONFIGURED, {}).size).toBe(0);
  });
});

// region | Helpers

/** Builds a commit whose block holds one entry per scope list, in order. */
function blockCommit(hash: string, scopeLists: ReadonlyArray<readonly string[]>): RawCommit {
  return makeCommit(hash, SUBJECT, blockPayload(scopeLists));
}

/** Builds a `change-record` block holding one `fix` entry per scope list. */
function blockPayload(scopeLists: ReadonlyArray<readonly string[]>): string {
  const entries = scopeLists.flatMap((scopes, index) => [
    '  - type: fix',
    `    scopes: [${scopes.map((scope) => `'${scope}'`).join(', ')}]`,
    `    text: Entry ${index + 1}.`,
  ]);
  return ['```change-record', 'entries:', ...entries, '```'].join('\n');
}

/** Builds a raw commit from its subject and body. */
function makeCommit(hash: string, subject: string, body: string): RawCommit {
  return { hash, subject, body, message: body === '' ? subject : `${subject}\n\n${body}` };
}

/** Builds a workspace window. */
function window(dir: string, commits: readonly RawCommit[]): WorkspaceWindow {
  return { dir, commits };
}

// endregion | Helpers
