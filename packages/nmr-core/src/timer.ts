// The repo's only importer of `@williamthorsen/toolbelt.datetime`, whose `/draft` API is experimental.

import { startTimer as startMonotonicTimer } from '@williamthorsen/toolbelt.datetime/draft';

/**
 * Starts a timer on the monotonic clock and returns a function reporting the whole milliseconds elapsed since this
 * call, which a wall-clock adjustment during the span cannot shorten or make negative.
 */
export function startTimer(): () => number {
  return startMonotonicTimer();
}
