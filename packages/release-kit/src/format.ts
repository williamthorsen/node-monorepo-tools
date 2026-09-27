import { styleText } from 'node:util';

/** Styles text bold, returning it unstyled for a stream that cannot render color. */
export function bold(text: string, stream: NodeJS.WritableStream = process.stdout): string {
  return styleText('bold', text, { stream });
}

/** Styles text dim, returning it unstyled for a stream that cannot render color. */
export function dim(text: string, stream: NodeJS.WritableStream = process.stdout): string {
  return styleText('dim', text, { stream });
}

/** Renders a section header for separating workspaces in CLI output. */
export function sectionHeader(name: string): string {
  return `━━━ ${name} ━━━`;
}
