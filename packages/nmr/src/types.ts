// The config shape, kept apart from both the loader and the `./config` entry so that neither has to import the
// other to reach it. The entry must not retain any module specifier at all, which a dependency on `config.ts` would
// break.
import type { ScriptValue } from './default-scripts.ts';
import type { CommandVerbosity } from './verbosity.ts';

export type { ScriptValue, StepSpec } from './default-scripts.ts';
export type { CommandVerbosity } from './verbosity.ts';

/** Build settings honored by `nmr-compile`. */
export interface BuildConfig {
  /**
   * Patterns added to the build's default ignore set. Extends rather than replaces, so that declaring one pattern
   * cannot silently drop the defaults and start publishing a package's own tests.
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
   * name whose chain turned out to do more than report an exit status. Every name has to resolve to a command.
   */
  excludeCommands?: string[];
  /**
   * Command names added to the cacheable set. Extends rather than replaces, so that declaring one command
   * cannot silently drop the defaults. A name listed here promises exit-status-only semantics through its whole
   * chain, hooks included, and has to resolve to a command: Both lists are read by name alone, so a misspelt
   * entry would otherwise be inert.
   */
  extraCommands?: string[];
}

/** Output settings honored at the monorepo root. */
export interface OutputConfig {
  /**
   * The verbosity that a run takes when neither `-q` nor the environment named one. Both of those outrank it.
   * Because it outranks agent-harness detection, `full` here is also how a repo declines to be detected.
   */
  commandVerbosity?: CommandVerbosity;
  /**
   * Environment-variable names added to the set whose presence marks an agent harness. Extends rather than
   * replaces, so that declaring one name cannot silently drop the built-in list, and a repo handles a harness's
   * rename without waiting for an nmr release.
   */
  extraAgentEnvVars?: string[];
}

export interface NmrConfig {
  build?: BuildConfig;
  checkCache?: CheckCacheConfig;
  devBin?: Record<string, string>;
  output?: OutputConfig;
  workspaceScripts?: Record<string, ScriptValue>;
  rootScripts?: Record<string, ScriptValue>;
}
