import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { renderQuotedList } from './helpers/renderQuotedList.ts';
import { formatFlagSpelling, formatShortSpelling, NMR_FLAGS, type NmrFlagKey } from './nmr-flags.ts';
import { quoteToken } from './shell-syntax.ts';

/** The flags that select delegation, in any spelling. */
const DELEGATION_FLAG_KEYS: readonly NmrFlagKey[] = ['delegate', 'delegateTo', 'noDelegate'];

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
  return DELEGATION_FLAG_KEYS.some((key) => {
    const spelling = formatFlagSpelling(key);
    return arg === spelling || arg.startsWith(`${spelling}=`);
  });
}

// region | Helpers

/** Returns the key of the nmr flag that an argument names, by its long name, its assignment, or its short name. */
function findFlagKey(arg: string): NmrFlagKey | undefined {
  const name = arg.split('=', 1)[0] ?? arg;
  for (const key of Object.keys(NMR_FLAGS)) {
    if (!isNmrFlagKey(key)) continue;
    if (name === formatFlagSpelling(key) || arg === formatShortSpelling(key)) {
      return key;
    }
  }

  return undefined;
}

/** Narrows an object key of `NMR_FLAGS` to the key type that `Object.keys` cannot infer. */
function isNmrFlagKey(key: string): key is NmrFlagKey {
  return Object.hasOwn(NMR_FLAGS, key);
}

/**
 * Returns how many arguments the nmr flag at `index` spans, or `undefined` when the argument is not one that the
 * parser would accept as an nmr flag with its value.
 */
function readMisplacedFlagLength(args: readonly string[], index: number): number | undefined {
  const arg = args[index] ?? '';
  const key = findFlagKey(arg);
  if (key === undefined) {
    return undefined;
  }

  const isAssignment = arg.includes('=');
  if (NMR_FLAGS[key].type === 'boolean') {
    return isAssignment ? undefined : 1;
  }

  if (isAssignment) {
    return arg.slice(arg.indexOf('=') + 1) === '' ? undefined : 1;
  }

  // An empty value is not one that the parser accepts, so the flag does not have a value to move.
  return (args[index + 1] ?? '') === '' ? undefined : 2;
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
