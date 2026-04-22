// ANSI escape helpers for styled terminal output.

/** Wrap text in ANSI bold. */
export function bold(text: string): string {
  return `\u001B[1m${text}\u001B[0m`;
}

/** Wrap text in ANSI dim. */
export function dim(text: string): string {
  return `\u001B[2m${text}\u001B[0m`;
}

/** Render a section header for separating workspaces in CLI output. */
export function sectionHeader(name: string): string {
  return `━━━ ${name} ━━━`;
}
