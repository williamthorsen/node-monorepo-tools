/** Print a step label with a right-arrow prefix. */
export function printStep(message: string): void {
  console.info(`\n> ${message}`);
}

/** Print a success message with a checkmark emoji prefix. */
export function printSuccess(message: string): void {
  console.info(`  ✅ ${message}`);
}

/** Print a skip/warning message to stdout. */
export function printSkip(message: string): void {
  console.info(`  ⚠️ ${message}`);
}

/** Print an error message to stderr. */
export function printError(message: string): void {
  console.error(`  ❌ ${message}`);
}
