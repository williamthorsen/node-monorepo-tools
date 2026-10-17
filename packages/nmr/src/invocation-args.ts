import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { renderQuotedList } from './helpers/renderQuotedList.ts';
import { OUTPUT_STYLE_FLAG } from './output-style.ts';
import { DELEGATE_FLAG, NO_DELEGATE_FLAG } from './remote-run.ts';
import { quoteToken } from './shell-syntax.ts';

/** Every spelling of the flag that takes a workspace filter pattern. */
const FILTER_FLAGS = new Set(['-F', '--filter']);

/** Every spelling of a boolean flag, paired with the field that it sets. */
const BOOLEAN_FLAGS = new Map<string, BooleanFlagName>([
  ['-?', 'shouldShowHelp'],
  ['--help', 'shouldShowHelp'],
  ['--json', 'shouldEmitJson'],
  ['--log', 'shouldPrintLog'],
  ['--no-cache', 'shouldBypassCache'],
  [NO_DELEGATE_FLAG, 'shouldRunLocally'],
  ['--no-lock', 'shouldBypassLock'],
  ['-q', 'quiet'],
  ['--quiet', 'quiet'],
  ['-R', 'recursive'],
  ['--recursive', 'recursive'],
  ['-V', 'shouldShowVersion'],
  ['--version', 'shouldShowVersion'],
  ['-w', 'isWorkspaceRoot'],
  ['--workspace-root', 'isWorkspaceRoot'],
]);

/**
 * Renders the hint for nmr flags written after the command name, or `undefined` when the arguments do not
 * contain any. The corrected invocation keeps every other argument where it was written.
 */
export function formatMisplacedFlagHint(
  args: readonly string[],
  passthrough: readonly string[],
  style: OutputStyle,
): string | undefined {
  const { flagNames, movedTokens, remainingTokens } = splitMisplacedFlags(passthrough);
  if (flagNames.length === 0) {
    return undefined;
  }

  const commandIndex = args.length - passthrough.length - 1;
  const correctedTokens = [
    'nmr',
    ...args.slice(0, commandIndex),
    ...movedTokens,
    ...args.slice(commandIndex, commandIndex + 1),
    ...remainingTokens,
  ];
  const subject = flagNames.length === 1 ? 'is an nmr flag' : 'are nmr flags';

  return (
    `${STATUS_GLYPHS[style].warning.text} ${renderQuotedList(flagNames)} ${subject}; ` +
    `nmr reads its flags only before the command: \`${correctedTokens.map(quoteToken).join(' ')}\``
  );
}

/** Reports whether an argument is one of nmr's delegation flags, in any spelling. */
export function isDelegationFlag(arg: string): boolean {
  return arg === DELEGATE_FLAG || arg === NO_DELEGATE_FLAG || arg.startsWith(`${DELEGATE_FLAG}=`);
}

/** Parses the CLI arguments into nmr's flags, the command name, and the arguments passed through to it. */
export function parseArgs(args: string[]): ParseResult {
  const parsedArgs: ParsedArgs = {
    isWorkspaceRoot: false,
    quiet: false,
    recursive: false,
    shouldBypassCache: false,
    shouldBypassLock: false,
    shouldEmitJson: false,
    shouldPrintLog: false,
    shouldRunLocally: false,
    shouldShowHelp: false,
    shouldShowVersion: false,
    passthrough: [],
  };

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined) break;

    if (FILTER_FLAGS.has(arg)) {
      index++;
      const filterValue = args[index];
      // An empty pattern is rejected with a missing one: composition reads a filter for its truth, so an
      // empty one would run the command unfiltered rather than in the scopes that the invocation asked for.
      if (!filterValue) {
        return { ok: false, error: '-F/--filter requires a pattern argument' };
      }
      parsedArgs.filter = filterValue;
      index++;
      continue;
    }

    const booleanFlag = BOOLEAN_FLAGS.get(arg);
    if (booleanFlag !== undefined) {
      parsedArgs[booleanFlag] = true;
      index++;
      continue;
    }

    const styleArgument = readOutputStyleArgument(args, index);
    if (styleArgument !== undefined) {
      if (!styleArgument.ok) {
        return styleArgument;
      }
      parsedArgs.outputStyle = styleArgument.value;
      index += styleArgument.consumedCount;
      continue;
    }

    const delegateArgument = readDelegateArgument(args, index);
    if (delegateArgument !== undefined) {
      if (!delegateArgument.ok) {
        return delegateArgument;
      }
      parsedArgs.delegateHost = delegateArgument.value;
      index += delegateArgument.consumedCount;
      continue;
    }

    parsedArgs.command = arg;
    parsedArgs.passthrough = args.slice(index + 1);
    break;
  }

  const error = findArgError(parsedArgs);

  return error === undefined ? { ok: true, parsedArgs } : { ok: false, error };
}

/** @internal */
export interface ParsedArgs {
  /** The host that `--delegate` names. */
  delegateHost?: string;
  filter?: string;
  isWorkspaceRoot: boolean;
  /** The flag's value as it was written, which the style resolver rather than the parser narrows. */
  outputStyle?: string;
  quiet: boolean;
  recursive: boolean;
  shouldBypassCache: boolean;
  shouldBypassLock: boolean;
  shouldEmitJson: boolean;
  shouldPrintLog: boolean;
  shouldRunLocally: boolean;
  shouldShowHelp: boolean;
  shouldShowVersion: boolean;
  command?: string;
  passthrough: string[];
}

// region | Helpers

/** A field that a flag sets by being written, none of which takes a value of its own. */
type BooleanFlagName =
  | 'isWorkspaceRoot'
  | 'quiet'
  | 'recursive'
  | 'shouldBypassCache'
  | 'shouldBypassLock'
  | 'shouldEmitJson'
  | 'shouldPrintLog'
  | 'shouldRunLocally'
  | 'shouldShowHelp'
  | 'shouldShowVersion';

/** What a flag that takes a value was given, and how many arguments it spent, or why it did not have a value. */
type FlagValueRead = { ok: true; value: string; consumedCount: number } | { ok: false; error: string };

type ParseResult = { ok: true; parsedArgs: ParsedArgs } | { ok: false; error: string };

/**
 * Returns what is wrong with a parsed invocation, or `undefined` when nothing is.
 *
 * `--log` names what to print rather than what to run, so an invocation that passes it without a command has
 * asked for nothing; the help text answers a different question and is not a stand-in for the flag's own grammar.
 */
function findArgError(parsedArgs: ParsedArgs): string | undefined {
  if (
    parsedArgs.shouldPrintLog &&
    parsedArgs.command === undefined &&
    !parsedArgs.shouldShowHelp &&
    !parsedArgs.shouldShowVersion
  ) {
    return '--log requires a command name: `nmr --log <command>`';
  }

  return undefined;
}

/**
 * Returns the host that `--delegate` at `index` names, or `undefined` when the argument is not the flag. Both
 * spellings are read, as for `--output-style`, and an empty value is rejected with a missing one.
 */
function readDelegateArgument(args: readonly string[], index: number): FlagValueRead | undefined {
  return readFlagValue(args, index, DELEGATE_FLAG, 'a host argument');
}

/**
 * Returns what the flag at `index` names when it is `flag`, in either the `--flag value` or the `--flag=value`
 * spelling, or `undefined` when the argument is a different one. An empty value is rejected with a missing one.
 */
function readFlagValue(
  args: readonly string[],
  index: number,
  flag: string,
  requirement: string,
): FlagValueRead | undefined {
  const arg = args[index] ?? '';
  const assignment = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  if (arg !== flag && assignment === undefined) {
    return undefined;
  }

  const value = assignment ?? args[index + 1];
  if (!value) {
    return { ok: false, error: `${flag} requires ${requirement}` };
  }

  return { ok: true, value, consumedCount: assignment === undefined ? 2 : 1 };
}

/**
 * Returns how many arguments the nmr flag at `index` spans, or `undefined` when the argument is not one that the
 * hint moves. Help and version are not moved: before the command, either one shows nmr's own output in place of
 * the run.
 */
function readMisplacedFlagLength(args: readonly string[], index: number): number | undefined {
  const arg = args[index] ?? '';

  if (FILTER_FLAGS.has(arg)) {
    // An empty pattern is not one that the parser accepts, so the flag does not have a value to move.
    return (args[index + 1] ?? '') === '' ? undefined : 2;
  }

  const booleanFlag = BOOLEAN_FLAGS.get(arg);
  if (booleanFlag !== undefined) {
    return booleanFlag === 'shouldShowHelp' || booleanFlag === 'shouldShowVersion' ? undefined : 1;
  }

  const valueArgument = readOutputStyleArgument(args, index) ?? readDelegateArgument(args, index);

  return valueArgument?.ok === true ? valueArgument.consumedCount : undefined;
}

/**
 * Returns what `--output-style` at `index` names, or `undefined` when the argument is not the flag.
 *
 * Both spellings are read, so neither `--output-style plain` nor `--output-style=plain` is taken for the
 * command name. An empty value is rejected with a missing one: nmr-core reads `''` as absent, which would
 * leave the flag naming whatever the variable or detection chose rather than what the invocation asked for.
 * The value itself is left to the resolver, which rejects it in the words that nmr's siblings use.
 */
function readOutputStyleArgument(args: readonly string[], index: number): FlagValueRead | undefined {
  return readFlagValue(args, index, OUTPUT_STYLE_FLAG, 'a value argument: auto, plain, or rich');
}

/**
 * Separates the nmr flags in a command's arguments, each with its value, from the arguments that belong to the
 * command. Everything from a `--` on belongs to the command.
 */
function splitMisplacedFlags(passthrough: readonly string[]): {
  flagNames: string[];
  movedTokens: string[];
  remainingTokens: string[];
} {
  const flagNames = new Set<string>();
  const movedTokens: string[] = [];
  const remainingTokens: string[] = [];

  let index = 0;
  while (index < passthrough.length) {
    const arg = passthrough[index] ?? '';
    if (arg === '--') {
      remainingTokens.push(...passthrough.slice(index));
      break;
    }

    const flagLength = readMisplacedFlagLength(passthrough, index);
    if (flagLength === undefined) {
      remainingTokens.push(arg);
      index++;
      continue;
    }

    flagNames.add(arg.split('=', 1)[0] ?? arg);
    movedTokens.push(...passthrough.slice(index, index + flagLength));
    index += flagLength;
  }

  return { flagNames: [...flagNames], movedTokens, remainingTokens };
}

// endregion | Helpers
