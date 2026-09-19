/**
 * The `--config` flag, shared by every subcommand that reads the config file.
 *
 * Spread into a subcommand's own schema rather than repeated, so that seven subcommands cannot drift to seven
 * spellings of one flag.
 */
export const configFlagSchema = {
  config: { long: '--config', type: 'string' as const },
};
