/** Returns a pull-request number given as a positive integer or its decimal string, else `undefined`. */
export function parsePullRequestNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
