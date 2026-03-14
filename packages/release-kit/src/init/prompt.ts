import { createInterface } from 'node:readline/promises';

/** Prompt the user for a yes/no answer. Returns `true` for yes, `false` for no. */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} (y/n) `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

/** Print a step label with a right-arrow prefix. */
export function printStep(message: string): void {
  console.info(`\n> ${message}`);
}

/** Print a success message with a checkmark prefix. */
export function printSuccess(message: string): void {
  console.info(`  [ok] ${message}`);
}

/** Print a skip message to stdout. */
export function printSkip(message: string): void {
  console.info(`  [skip] ${message}`);
}

/** Print an error message to stderr. */
export function printError(message: string): void {
  console.error(`  [error] ${message}`);
}
