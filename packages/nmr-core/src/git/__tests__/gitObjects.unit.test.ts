import { describe, expect, it } from 'vitest';

import {
  type GitTreeEntry,
  hashGitObject,
  parseObjectFormat,
  parseTreeObject,
  serializeTreeObject,
  TREE_MODE,
} from '../gitObjects.ts';

// The ids that git reports for these objects, from `git hash-object` and `git mktree`.
const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const EMPTY_TREE_SHA256 = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321';
const HELLO_BLOB_SHA1 = 'ce013625030ba8dba906f756967f9e9ca394464a';

describe(hashGitObject, () => {
  it('matches the id that git reports for a blob', () => {
    expect(hashGitObject('sha1', 'blob', Buffer.from('hello\n')).toString('hex')).toBe(HELLO_BLOB_SHA1);
  });

  it('matches the id that git reports for the empty tree in each object format', () => {
    expect(hashGitObject('sha1', 'tree', Buffer.alloc(0)).toString('hex')).toBe(EMPTY_TREE_SHA1);
    expect(hashGitObject('sha256', 'tree', Buffer.alloc(0)).toString('hex')).toBe(EMPTY_TREE_SHA256);
  });
});

describe(parseObjectFormat, () => {
  it('accepts the formats that it can hash and rejects any other', () => {
    expect(['sha1', 'sha256', 'md5'].map(parseObjectFormat)).toStrictEqual(['sha1', 'sha256', undefined]);
  });
});

describe(serializeTreeObject, () => {
  it('orders a subtree as though its name ended in a slash', () => {
    // Bytes order `a-` before `a/` before `a0`, so the subtree `a` lands between the two files.
    const entries = [buildEntry('a0', '100644'), buildEntry('a', TREE_MODE), buildEntry('a-', '100644')];

    const names = parseTreeObject('sha1', serializeTreeObject(entries))?.map((parsed) => parsed.name);

    expect(names).toStrictEqual(['a-', 'a', 'a0']);
  });

  it('round-trips through parseTreeObject, keeping names that are not valid UTF-8', () => {
    const entries = [buildEntry('link', '120000'), buildEntry('é', '100755')];

    expect(parseTreeObject('sha1', serializeTreeObject(entries))).toStrictEqual(entries);
  });
});

describe(parseTreeObject, () => {
  it('rejects content that ends inside an entry', () => {
    const content = serializeTreeObject([buildEntry('file', '100644')]);

    expect(parseTreeObject('sha1', content.subarray(0, -1))).toBeUndefined();
  });
});

// region | Helpers

/** Builds an entry whose id is a fixed SHA-1-length placeholder. */
function buildEntry(name: string, mode: string): GitTreeEntry {
  return { id: Buffer.alloc(20, 0xab), mode, name };
}

// endregion | Helpers
