// The config shape, held apart from both the loader and the `./config` entry so that neither has to import the
// other to reach it. The entry must retain no module specifier at all, which a dependency on `config.ts` would break.
import type { CommandVerbosity } from './verbosity.ts';

export type { CommandVerbosity } from './verbosity.ts';

/** Build settings honored by `nmr-compile`. */
export interface BuildConfig {
  /**
   * Patterns added to the build's default ignore set. Extends rather than replaces, so that declaring one pattern
   * cannot silently drop the defaults and start shipping a package's own tests.
   * The programmatic `buildPackage` option of the same name behaves identically; its bare `ignorePatterns` replaces.
   */
  extraIgnorePatterns?: string[];
}

/** Check-result cache settings honored at the monorepo root. */
export interface CheckCacheConfig {
  /** Set to `false` to turn the gate off entirely, so every command runs. */
  enabled?: boolean;
  /**
   * Command names removed from the cacheable set, applied after `extraCommands`. This is how a repo retires a
   * name whose chain turned out to do more than report an exit status.
   */
  excludeCommands?: string[];
  /**
   * Command names added to the cacheable set. Extends rather than replaces, so that declaring one command
   * cannot silently drop the defaults. A name listed here promises exit-status-only semantics through its whole
   * chain, hooks included.
   */
  extraCommands?: string[];
}

/** Output settings honored at the monorepo root. */
export interface OutputConfig {
  /**
   * The verbosity a run takes when neither `-q` nor the environment named one. Both of those outrank it, and it
   * outranks agent-harness detection, so `full` here is also how a repo declines to be detected.
   */
  commandVerbosity?: CommandVerbosity;
  /**
   * Environment-variable names added to the set whose presence marks an agent harness. Extends rather than
   * replaces, so that declaring one name cannot silently drop the shipped list, and a repo absorbs a harness's
   * rename without waiting for an nmr release.
   */
  extraAgentEnvVars?: string[];
}

export interface NmrConfig {
  build?: BuildConfig;
  checkCache?: CheckCacheConfig;
  devBin?: Record<string, string>;
  output?: OutputConfig;
  workspaceScripts?: Record<string, string | string[]>;
  rootScripts?: Record<string, string | string[]>;
}
