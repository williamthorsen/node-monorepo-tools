/**
 * Vitest setup file that keeps the developer's git config out of the git subprocesses a test spawns.
 *
 * A suite that runs `git` otherwise reads the ambient identity, signing settings, and ignore rules, so it passes
 * against whatever the developer happens to have configured and can block outright on a signing passphrase.
 *
 * `defineVitestConfig` loads this into every project by default; see nmr's `isolateGit` option.
 */
import os from 'node:os';

// The null device reads as an empty config file, which is what leaves git with no global or system settings at all.
process.env['GIT_CONFIG_GLOBAL'] = os.devNull;
process.env['GIT_CONFIG_SYSTEM'] = os.devNull;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

// The excludes file survives the three above: its path is not config-derived, so git falls back to
// `$XDG_CONFIG_HOME/git/ignore`, or `~/.config/git/ignore` where that is unset, whatever the config says. Injecting
// `core.excludesFile` through the environment settles it without touching `XDG_CONFIG_HOME`, which other tools
// spawned by a test read for configuration of their own.
process.env['GIT_CONFIG_COUNT'] = '1';
process.env['GIT_CONFIG_KEY_0'] = 'core.excludesFile';
process.env['GIT_CONFIG_VALUE_0'] = os.devNull;
