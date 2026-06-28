import process from 'node:process';
import { parseArgs as nodeParseArgs } from 'node:util';

/** Schema entry describing a single CLI flag. */
export interface FlagDefinition {
  long: string;
  type: 'boolean' | 'string';
  short?: string;
}

/** Map of camelCase property names to their flag definitions. */
export type FlagSchema = Record<string, FlagDefinition>;

/** Infer the result type from a flag schema: booleans become `boolean`, strings become `string | undefined`. */
export type ParsedFlags<S extends FlagSchema> = {
  [K in keyof S]: S[K]['type'] extends 'boolean' ? boolean : string | undefined;
};

/** Return type of `parseArgs`: typed flags plus collected positionals. */
export interface ParsedArgs<S extends FlagSchema> {
  flags: ParsedFlags<S>;
  positionals: string[];
}

/** Discriminates the failure modes `parseArgs` reports. */
export type ParseErrorKind = 'unknown-flag' | 'missing-value' | 'unexpected-value';

/**
 * Error thrown by `parseArgs` on invalid input.
 *
 * Carries the failure `kind` and the offending `flag` (as the user typed it); its `message` is
 * composed from those fields, so error wording is uniform across every kind.
 */
export class ParseError extends Error {
  readonly kind: ParseErrorKind;
  readonly flag: string;

  constructor(kind: ParseErrorKind, flag: string) {
    super(formatParseErrorMessage(kind, flag));
    this.name = 'ParseError';
    this.kind = kind;
    this.flag = flag;
  }
}

/**
 * Parse a pre-sliced argv array against a flag schema.
 *
 * Delegates tokenizing to `node:util.parseArgs` (non-strict, with tokens) and validates the token
 * stream against the schema. Throws `ParseError` on an unknown flag, a missing string-flag value, or
 * a value supplied to a boolean flag. Does not write output or exit.
 */
export function parseArgs<S extends FlagSchema>(argv: string[], schema: S): ParsedArgs<S> {
  const nodeOptions: Record<string, { type: 'boolean' | 'string'; short?: string }> = {};
  const byName = new Map<string, { key: string; def: FlagDefinition }>();
  const flags: Record<string, boolean | string | undefined> = {};

  for (const [key, def] of Object.entries(schema)) {
    const name = def.long.replace(/^--/, '');
    nodeOptions[name] =
      def.short === undefined ? { type: def.type } : { type: def.type, short: def.short.replace(/^-/, '') };
    byName.set(name, { key, def });
    flags[key] = def.type === 'boolean' ? false : undefined;
  }

  const { tokens } = nodeParseArgs({
    args: argv,
    options: nodeOptions,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'positional') {
      positionals.push(token.value);
      continue;
    }
    // Skip the `--` terminator: node emits the trailing arguments as their own positional tokens.
    if (token.kind !== 'option') {
      continue;
    }

    const entry = byName.get(token.name);
    if (entry === undefined) {
      throw new ParseError('unknown-flag', token.rawName);
    }

    if (entry.def.type === 'boolean') {
      if (token.value !== undefined) {
        throw new ParseError('unexpected-value', token.rawName);
      }
      flags[entry.key] = true;
      continue;
    }

    const value = token.value;
    // Reject an absent value, an empty `--flag=`, and a value that is actually the next flag (`-` alone is a valid value).
    if (value === undefined || value === '' || (!token.inlineValue && value.startsWith('-') && value !== '-')) {
      throw new ParseError('missing-value', token.rawName);
    }
    flags[entry.key] = value;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Schema-driven initialization guarantees the generic return shape; TypeScript cannot infer it through the dynamic key writes.
  return { flags, positionals } as ParsedArgs<S>;
}

/**
 * Parse argv, or print a usage error to stderr and exit non-zero.
 *
 * The canonical "parse or die" entry point for CLI commands that terminate on invalid input.
 */
export function parseArgsOrExit<S extends FlagSchema>(argv: string[], schema: S): ParsedArgs<S> {
  try {
    return parseArgs(argv, schema);
  } catch (error: unknown) {
    if (error instanceof ParseError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

/** Compose the user-facing message for a parse failure, uniformly cased across all kinds. */
function formatParseErrorMessage(kind: ParseErrorKind, flag: string): string {
  switch (kind) {
    case 'unknown-flag':
      return `Unknown option: ${flag}`;
    case 'missing-value':
      return `Missing value for option: ${flag}`;
    case 'unexpected-value':
      return `Option does not accept a value: ${flag}`;
  }
}
