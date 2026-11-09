// Command-line parsing, help, routing, and output-style resolution for the repo's CLIs, and the repo's only importer
// of `@williamthorsen/toolbelt.cli`.

import { UsageError } from '@williamthorsen/toolbelt.cli/candidate';

import {
  describeInvalidOutputStyle,
  resolveStreamStyles,
  type ResolveStreamStylesOptions,
  type StreamStyles,
} from './terminal.ts';

export type {
  Command,
  CommandInput,
  CommandNode,
  FlagDefinition,
  FlagSchema,
  Group,
  OperandDefinition,
  ParsedFlags,
  ParsedOperands,
  ParseErrorKind,
  ParseOptions,
  ParseResult,
  ParseSpec,
  PassthroughInput,
  RenderHelpOptions,
  RunCliOptions,
  Writer,
} from '@williamthorsen/toolbelt.cli/candidate';
export {
  createCli,
  defineCommand,
  defineGroup,
  parseArgs,
  ParseError,
  readStreamText,
  renderHelp,
  runCli,
  UsageError,
} from '@williamthorsen/toolbelt.cli/candidate';

/** The process state from which a CLI resolves its styles, as a router passes it to each command. */
export type CliStyleContext = Omit<ResolveStreamStylesOptions, 'argv' | 'envVar' | 'flag'>;

export type ResolveCliStylesOptions = CliStyleContext & Pick<ResolveStreamStylesOptions, 'envVar'>;

/** Resolves the style of each output stream, throwing a `UsageError` when `envVar` doesn't name a setting. */
export function resolveCliStyles(options: ResolveCliStylesOptions): StreamStyles {
  const { invalid, styles } = resolveStreamStyles(options);
  if (invalid !== undefined) {
    throw new UsageError(describeInvalidOutputStyle(invalid));
  }
  return styles;
}
