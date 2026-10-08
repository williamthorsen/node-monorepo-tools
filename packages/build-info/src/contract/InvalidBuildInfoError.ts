/** An error reporting that a value does not satisfy the `BuildInfo` contract. */
export class InvalidBuildInfoError extends Error {
  /**
   * The path of the first invalid field, such as `commit.sha` or `releaseNotes.sections[0].title`. It is empty when the
   * value as a whole is invalid, such as a string that is not JSON.
   */
  readonly path: string;

  constructor(path: string, reason: string, options?: ErrorOptions) {
    super(`${path === '' ? 'value' : path}: ${reason}`, options);
    this.name = 'InvalidBuildInfoError';
    this.path = path;
  }
}
