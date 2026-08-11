/**
 * A failure in what the user declared -- a config file, a `package.json` -- rather than a fault in nmr.
 *
 * The CLI boundary prints one of these as its message alone. A stack trace records where nmr noticed the
 * problem, which says nothing about the file the reader has to edit.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
