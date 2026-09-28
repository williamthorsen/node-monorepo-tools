/**
 * Reports the line that closes a bin's output, separated from the items above it by a blank line.
 *
 * When a bin prints one line per item, the last line that a reader sees is whichever item happened to be last.
 * The convention that this implements: The header says what the list is, and the closing statement says what
 * the run concluded, so the count and the remedy are stated here rather than in the header. The blank line makes
 * the statement findable once the lines are flattened.
 *
 * The closer is one write and cannot be interleaved: The blank line goes in the same call as the statement.
 * `log` writes the closer to the stream that its items went to: A bin reporting to stderr passes `console.warn`.
 *
 * A bin whose whole output is one or two statements about one subject does not have any items to be separated
 * from, and closes by printing plainly rather than through here.
 */
export function reportClosing(message: string, log: (line: string) => void = console.info): void {
  log(`\n${message}`);
}
