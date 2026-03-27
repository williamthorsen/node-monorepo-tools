function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Retrieves a nested value from an object using a dot-separated path.
 * Supports both object keys and array indices.
 *
 * @throws If any segment is missing or if an unexpected structure is encountered.
 */
export function getValueAtPathOrThrow(obj: unknown, objPath: string): unknown {
  if (!isObject(obj)) {
    throw new Error('Expected an object as root value.');
  }

  const keys = objPath.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (Number.isNaN(index)) {
        throw new TypeError(`Expected array index at segment "${key}" in path "${objPath}"`);
      }
      if (index >= 0 && index < current.length) {
        current = current[index];
      } else {
        throw new Error(`Array index out of bounds: "${key}" in path "${objPath}"`);
      }
    } else if (isObject(current)) {
      if (!(key in current)) {
        throw new Error(`Missing key "${key}" in path "${objPath}"`);
      }
      current = current[key];
    } else {
      throw new Error(`Unexpected non-object/non-array at segment "${key}" in path "${objPath}"`);
    }
  }

  return current;
}
