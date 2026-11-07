// `config.ts` reaches this module through `steps.ts`, so it is in the bootstrap's import closure, which runs under bare
// `node` before any package is built: It imports nothing of nmr's own and stays erasable TypeScript.

import { type FlagSchema, parseArgs, type ParsedFlags, ParseError } from '@williamthorsen/nmr-core/cli';

/** nmr's own flags, each read only before the command name. */
export const NMR_FLAGS = {
  delegate: {
    type: 'boolean',
    description: 'Run over SSH on the first free host that NMR_DELEGATE or the user config names',
  },
  delegateTo: {
    type: 'string',
    description: 'Run over SSH on the first free of <hosts>, comma-separated',
    valueHint: 'hosts',
  },
  filter: {
    type: 'string',
    description: 'Run command in packages whose manifest name matches',
    short: 'F',
    valueHint: 'pattern',
  },
  json: { type: 'boolean', description: 'Report one JSON object per command, withholding command output' },
  log: { type: 'boolean', description: 'Print the recorded run instead of running (up to 256 KiB)' },
  noCache: { type: 'boolean', description: 'Run even if this tree already passed; record the result' },
  noDelegate: { type: 'boolean', description: 'Run here, whatever NMR_DELEGATE or the user config says' },
  noLock: { type: 'boolean', description: 'Run without waiting for another heavy command on this machine' },
  outputStyle: {
    type: 'string',
    description: 'Output style: auto (default), plain, or rich',
    valueHint: 'auto|plain|rich',
  },
  quiet: { type: 'boolean', description: "Suppress command output, keeping nmr's verdicts", short: 'q' },
  recursive: { type: 'boolean', description: 'Run command in all packages', short: 'R' },
  workspaceRoot: { type: 'boolean', description: 'Use root scripts, running at the monorepo root', short: 'w' },
} satisfies FlagSchema;

/** The key of one of nmr's flags. */
export type NmrFlagKey = keyof typeof NMR_FLAGS;

/** @internal */
export interface ParsedArgs {
  /** The comma-separated hosts that `--delegate-to` names, as written. */
  delegateHosts?: string;
  filter?: string;
  isWorkspaceRoot: boolean;
  /** The flag's value as it was written, which the style resolver rather than the parser narrows. */
  outputStyle?: string;
  quiet: boolean;
  recursive: boolean;
  shouldBypassCache: boolean;
  shouldBypassLock: boolean;
  /** Set by `--delegate`, which leaves the hosts to `NMR_DELEGATE` or the user config. */
  shouldDelegate: boolean;
  shouldEmitJson: boolean;
  shouldPrintLog: boolean;
  shouldRunLocally: boolean;
  shouldShowHelp: boolean;
  shouldShowVersion: boolean;
  command?: string;
  passthrough: string[];
}

/** What the arguments ask of nmr, or that its flags do not parse. */
export type FlagReading = { ok: true; parsedArgs: ParsedArgs } | { ok: false };

/** Returns the `--long` spelling of one of nmr's flags. */
export function formatFlagSpelling(key: NmrFlagKey): string {
  return `--${toKebabCase(key)}`;
}

/** Returns the `-x` spelling of one of nmr's flags, or `undefined` when it does not have one. */
export function formatShortSpelling(key: NmrFlagKey): string | undefined {
  const definition = NMR_FLAGS[key];

  return 'short' in definition ? `-${definition.short}` : undefined;
}

/**
 * Reads nmr's flags, the command name, and the arguments passed through to it, without reporting anything.
 *
 * The help and version flags are read here as well, though the router reserves them, so that a caller can tell
 * what the invocation asks for before it builds the command tree. Arguments whose flags do not parse report only
 * that: The router parses the same arguments against the same schema and reports the error itself.
 */
export function readInvocationFlags(args: readonly string[]): FlagReading {
  // The parser reserves the help flags, so each one that it rejects before the command is set aside and read here.
  const remaining = [...args];
  let shouldShowHelp = false;
  for (;;) {
    try {
      const parsed = parseArgs(remaining, { flags: READER_FLAGS }, { stopAtPositional: true });
      return { ok: true, parsedArgs: { ...toParsedArgs(parsed.flags, parsed.rest), shouldShowHelp } };
    } catch (error: unknown) {
      if (!(error instanceof ParseError)) {
        throw error;
      }
      if (
        error.kind !== 'unknown-flag' ||
        !HELP_SPELLINGS.has(error.token) ||
        !removeHelpFlag(remaining, error.token)
      ) {
        return { ok: false };
      }
      shouldShowHelp = true;
    }
  }
}

/**
 * Maps nmr's parsed flags, and the arguments from the command name on, to the fields that the rest of nmr reads.
 * Help is false, since the parser reserves it, and version is false unless the flags include it.
 */
export function toParsedArgs(
  flags: ParsedFlags<typeof NMR_FLAGS> & { version?: boolean },
  rest: readonly string[],
): ParsedArgs {
  const [first, ...remaining] = rest;
  const hasCommand = first !== undefined && first !== '--';

  return {
    ...(flags.delegateTo !== undefined && { delegateHosts: flags.delegateTo }),
    ...(flags.filter !== undefined && { filter: flags.filter }),
    isWorkspaceRoot: flags.workspaceRoot,
    ...(flags.outputStyle !== undefined && { outputStyle: flags.outputStyle }),
    quiet: flags.quiet,
    recursive: flags.recursive,
    shouldBypassCache: flags.noCache,
    shouldBypassLock: flags.noLock,
    shouldDelegate: flags.delegate,
    shouldEmitJson: flags.json,
    shouldPrintLog: flags.log,
    shouldRunLocally: flags.noDelegate,
    shouldShowHelp: false,
    shouldShowVersion: flags.version ?? false,
    ...(hasCommand && { command: first }),
    passthrough: hasCommand ? remaining : [],
  };
}

// region | Helpers

/** The spellings of the help flag, which the router reserves at every level. */
const HELP_SPELLINGS: ReadonlySet<string> = new Set(['--help', '-h']);

/** nmr's flags plus the version flag that the router reserves at the root. */
const READER_FLAGS = {
  ...NMR_FLAGS,
  version: { type: 'boolean', description: 'Print the version', short: 'V' },
} satisfies FlagSchema;

/** Reports whether an argument clusters short flags that take no value, the reserved help and version included. */
function isBooleanCluster(arg: string): boolean {
  if (!/^-[^-]./.test(arg)) {
    return false;
  }

  const booleanShorts = new Set(['h', 'V']);
  for (const definition of Object.values(NMR_FLAGS)) {
    if (definition.type === 'boolean' && 'short' in definition) {
      booleanShorts.add(definition.short);
    }
  }

  for (const letter of arg.slice(1)) {
    if (!booleanShorts.has(letter)) {
      return false;
    }
  }

  return true;
}

/**
 * Removes the help flag that the parser rejected from `args`: the whole argument when it is one, or else its `h`
 * from the first cluster of boolean short flags that contains one, such as `-wh`. Reports whether it found the flag.
 */
function removeHelpFlag(args: string[], token: string): boolean {
  const index = args.indexOf(token);
  if (index !== -1) {
    args.splice(index, 1);
    return true;
  }

  const clusterIndex = args.findIndex((arg) => isBooleanCluster(arg) && arg.includes('h'));
  const cluster = args[clusterIndex];
  if (cluster === undefined) {
    return false;
  }

  args[clusterIndex] = cluster.replace('h', '');
  return true;
}

/** Converts a camel-case flag key to the kebab-case long name that the router derives from it. */
function toKebabCase(key: string): string {
  return key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// endregion | Helpers
