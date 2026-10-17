/**
 * Shell-escapes a single argument by wrapping in single quotes
 * and escaping any embedded single quotes.
 */
export function quoteForShell(arg: string): string {
  return "'" + arg.replace(/'/g, String.raw`'\''`) + "'";
}
