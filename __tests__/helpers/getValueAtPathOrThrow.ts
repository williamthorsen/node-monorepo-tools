import { isObject } from '@williamthorsen/toolbelt.objects';

/**
 * Retrieves a nested value from an object using a dot-separated path.
 *
 * @param obj - The root object to query.
 * @param path - Dot-separated path string, e.g., "jobs.code-quality.steps".
 * @returns The value at the given path.
 * @throws If any segment is missing or if an unexpected structure is encountered.
 */
export function getValueAtPathOrThrow(obj: unknown, path: string): unknown {
  if (!isObject(obj)) {
    throw new Error('Expected an object as root value.');
  }

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (Number.isNaN(index)) {
        throw new TypeError(`Expected array index at segment "${key}" in path "${path}"`);
      }
      if (index >= 0 && index < current.length) {
        current = current[index];
      } else {
        throw new Error(`Array index out of bounds: "${key}" in path "${path}"`);
      }
    } else if (isObject(current)) {
      if (!(key in current)) {
        throw new Error(`Missing key "${key}" in path "${path}"`);
      }
      current = current[key];
    } else {
      throw new Error(`Unexpected non-object/non-array at segment "${key}" in path "${path}"`);
    }
  }

  return current;
}
