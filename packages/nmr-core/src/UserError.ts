/**
 * A failure that the tool anticipated -- in the user's input, config, or environment, including a failed external
 * command -- rather than a fault in the tool.
 *
 * A CLI's last-resort handler prints one of these, or a Node system error, as `Error: <message>`, and anything else as an
 * internal error.
 */
export class UserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserError';
  }
}
