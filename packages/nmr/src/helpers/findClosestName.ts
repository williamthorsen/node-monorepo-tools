/**
 * Finds the candidate closest to a name, or `undefined` where none is near enough to be worth naming.
 *
 * The ceiling scales with the name's length, so a short name admits one slip and a long one a few. A fixed
 * ceiling would either miss a typo in `root:test:coverage` or offer `fix` for `ci`.
 */
export function findClosestName(name: string, candidates: Iterable<string>): string | undefined {
  const ceiling = Math.max(1, Math.floor(name.length / 4));

  let closest: string | undefined;
  let shortest = Infinity;
  for (const candidate of candidates) {
    const distance = measureDistance(name, candidate);
    if (distance < shortest) {
      shortest = distance;
      closest = candidate;
    }
  }

  return shortest <= ceiling ? closest : undefined;
}

// region | Helpers

/**
 * Measures the Levenshtein distance between two strings: the fewest single-character insertions, deletions, and
 * substitutions that turn one into the other.
 *
 * Holds two rows rather than the whole matrix. This runs only while composing a rejection, over the names one
 * repo declares, so the matrix is small and the cost is paid on a path that is already failing.
 */
function measureDistance(first: string, second: string): number {
  if (first.length === 0 || second.length === 0) {
    return Math.max(first.length, second.length);
  }

  let previous = Array.from({ length: second.length + 1 }, (_unused, column) => column);
  let current: number[] = Array.from({ length: second.length + 1 }, () => 0);

  for (let row = 1; row <= first.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= second.length; column += 1) {
      const substitution = readCell(previous, column - 1) + (first[row - 1] === second[column - 1] ? 0 : 1);
      current[column] = Math.min(readCell(current, column - 1) + 1, readCell(previous, column) + 1, substitution);
    }
    const completed = current;
    current = previous;
    previous = completed;
  }

  return readCell(previous, second.length);
}

/** Reads one cell of a matrix row. Every index here is bounded by the row's own length, so a gap is a defect. */
function readCell(row: readonly number[], index: number): number {
  const value = row[index];
  if (value === undefined) {
    throw new RangeError(`No cell at index ${index} in a row of ${row.length}`);
  }

  return value;
}

// endregion | Helpers
