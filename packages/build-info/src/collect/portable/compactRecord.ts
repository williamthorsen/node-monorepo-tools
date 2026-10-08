/** Returns a copy of the record without its `undefined` properties, or `undefined` when none remain. */
export function compactRecord<T extends object>(record: { [K in keyof T]: T[K] | undefined }): Partial<T> | undefined {
  const result: Partial<T> = {};
  let isEmpty = true;
  for (const key in record) {
    if (!Object.hasOwn(record, key)) {
      continue;
    }
    const value = record[key];
    if (value !== undefined) {
      result[key] = value;
      isEmpty = false;
    }
  }
  return isEmpty ? undefined : result;
}
