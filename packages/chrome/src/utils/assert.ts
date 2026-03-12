export function assert(condition: unknown, message = ''): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}
