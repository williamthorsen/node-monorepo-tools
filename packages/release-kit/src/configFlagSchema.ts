/**
 * The `--config` flag, shared by every subcommand that reads the config file.
 *
 * Spread into a subcommand's own schema rather than repeated, so that the subcommands cannot drift to different
 * spellings of one flag.
 */
export const configFlagSchema = {
  config: { long: '--config', type: 'string' as const },
};
