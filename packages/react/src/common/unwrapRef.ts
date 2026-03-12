import type { RefObject } from 'react';

/**
 * Unwraps a React.MutableRefObject and returns the inner value.
 */
export function unwrapRef<T>(ref: RefObject<T>): T {
  return ref.current;
}
