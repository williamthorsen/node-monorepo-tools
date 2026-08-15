/**
 * Reports the line that closes a bin's output, separated from the items above it by a blank line.
 *
 * A bin that prints one line per item leaves a reader who reaches the end holding whichever item happened to
 * be last. The convention this writes: the header says what the list is, and the closing statement says what
 * the run came to, so the count and the remedy live here rather than in the header. The blank line is what
 * makes the statement findable once the lines are flattened.
 *
 * The blank line rides in the same call as the statement, so the closer is one write and cannot be
 * interleaved. `log` is what puts the closer on the stream its items went to: a bin reporting to stderr
 * passes `console.warn`.
 *
 * A bin whose whole output is one or two statements about one subject has no items to be separated from, and
 * closes by printing plainly rather than through here.
 */
export function reportClosing(message: string, log: (line: string) => void = console.info): void {
  log(`\n${message}`);
}
