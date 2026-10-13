/** Ends the arguments that taze reads: Everything past it is collected for a downstream tool. */
export const ARGUMENT_TERMINATOR = '--';

/** A flag found among the arguments that taze reads, with the value given to it, if any. */
export interface FlagReading {
  value: string | undefined;
}

/**
 * Inserts `inserted` after the arguments that taze reads, ahead of a bare `--` so that taze still reads them.
 */
export function insertBeforeTerminator(args: readonly string[], inserted: readonly string[]): string[] {
  const terminatorIndex = args.indexOf(ARGUMENT_TERMINATOR);
  if (terminatorIndex === -1) return [...args, ...inserted];
  return [...args.slice(0, terminatorIndex), ...inserted, ...args.slice(terminatorIndex)];
}

/** Reports whether the invocation silences taze's output, in any spelling that taze's CLI accepts. */
export function isSilent(args: readonly string[]): boolean {
  return readFlag(args, ['--silent', '-s']) !== undefined || readFlag(args, ['--loglevel'])?.value === 'silent';
}

/**
 * Finds the first of `spellings` among the arguments that taze reads, returning the value given in its `=value`
 * form or as the next argument. A next argument that starts with `-` is another flag, not a value.
 */
export function readFlag(args: readonly string[], spellings: readonly string[]): FlagReading | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg === ARGUMENT_TERMINATOR) return undefined;
    for (const spelling of spellings) {
      if (arg.startsWith(`${spelling}=`)) return { value: arg.slice(spelling.length + 1) };
      if (arg === spelling) {
        const next = args[index + 1];
        return { value: next === undefined || next.startsWith('-') ? undefined : next };
      }
    }
  }
  return undefined;
}
