/** The paths named by a `git status --porcelain=v2 -z` output, or the reason that they could not be read. */
export type ChangedPathsResult = { ok: true; paths: Set<string> } | { ok: false; reason: string };

/**
 * The count of space-separated fields that precede the path in each `--porcelain=v2` record type. A type absent
 * from this map is one that the parser does not recognize, which fails closed.
 */
const PRECEDING_FIELD_COUNTS: Record<string, number | undefined> = {
  1: 8,
  2: 9,
  '?': 1,
  u: 10,
};

/** The record types that report, in their third field, whether the path that they name is a submodule. */
const SUBMODULE_BEARING_TYPES = new Set(['1', '2', 'u']);

/**
 * Extracts every path named by a `--porcelain=v2 -z` status. An unrecognized record type fails closed: A record
 * that this parser cannot read may name a path whose content would then go unhashed, which is the one failure that
 * a content identity may never have.
 *
 * Record shapes, each a NUL-terminated field: An ordinary change (`1`) and an unmerged path (`u`) have their
 * path last, after a fixed count of space-separated fields; a rename or copy (`2`) has its new path last and
 * its original path in the field that follows; an untracked path (`?`) has its path alone.
 */
export function collectChangedPaths(statusOutput: string): ChangedPathsResult {
  const records = statusOutput.split('\0');
  const paths = new Set<string>();

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record === '') {
      continue;
    }

    const type = record.slice(0, 1);
    if (type === '#') {
      continue;
    }

    // A submodule reports its state in the third field; this check catches one that `.gitmodules` does not declare.
    if (SUBMODULE_BEARING_TYPES.has(type) && extractField(record, 2)?.startsWith('S') === true) {
      return { ok: false, reason: 'the working tree contains a submodule, whose content this hash does not cover' };
    }

    const precedingFieldCount = PRECEDING_FIELD_COUNTS[type];
    if (precedingFieldCount === undefined) {
      return { ok: false, reason: `unrecognized git status record: ${JSON.stringify(record.slice(0, 40))}` };
    }

    const changedPath = extractPath(record, precedingFieldCount);
    if (changedPath === undefined) {
      return { ok: false, reason: `malformed git status record: ${JSON.stringify(record.slice(0, 40))}` };
    }
    paths.add(changedPath);

    if (type !== '2') {
      continue;
    }
    // The original path of a rename is the next field, and no longer exists on disk; including it is what removes
    // the entry from its old place in the tree.
    index++;
    const originalPath = records[index];
    if (originalPath === undefined || originalPath === '') {
      return { ok: false, reason: 'git status reported a rename without an original path' };
    }
    paths.add(originalPath);
  }

  return { ok: true, paths };
}

// region | Helpers

/** Returns the space-separated field at `fieldIndex`, or `undefined` when the record does not have that field. */
function extractField(record: string, fieldIndex: number): string | undefined {
  return record.split(' ')[fieldIndex];
}

/**
 * Returns a record's trailing path: everything past the first `precedingFieldCount` space-separated fields.
 * Taking the remainder rather than a field keeps paths containing spaces intact.
 */
function extractPath(record: string, precedingFieldCount: number): string | undefined {
  let index = 0;
  for (let field = 0; field < precedingFieldCount; field++) {
    const separator = record.indexOf(' ', index);
    if (separator === -1) {
      return undefined;
    }
    index = separator + 1;
  }

  const extracted = record.slice(index);
  return extracted === '' ? undefined : extracted;
}

// endregion | Helpers
