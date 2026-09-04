/**
 * Vitest setup file that keeps the developer's git config out of the git subprocesses a test spawns.
 *
 * A suite that runs `git` otherwise reads the ambient identity, signing settings, ignore rules, and attributes,
 * so it passes against whatever the developer happens to have configured and can block outright on a signing
 * passphrase.
 *
 * `defineVitestConfig` loads this into every project by default; see nmr's `isolateGit` option.
 */
import os from 'node:os';

// The null device reads as an empty config file, which is what leaves git with no global or system settings at all.
process.env['GIT_CONFIG_GLOBAL'] = os.devNull;
process.env['GIT_CONFIG_SYSTEM'] = os.devNull;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

// The excludes and attributes files survive the three above: neither path is config-derived, so git resolves each
// from `$XDG_CONFIG_HOME/git/`, or from `~/.config/git/` where that variable is unset, whatever the config says.
// `GIT_CONFIG_GLOBAL` already replaces `$XDG_CONFIG_HOME/git/config`, so these two are the whole remainder.
// Injecting the keys through the environment reaches them without redirecting `XDG_CONFIG_HOME`, which other tools
// spawned by a test read for configuration of their own: pnpm fails to start where that variable points at the
// null device.
process.env['GIT_CONFIG_COUNT'] = '2';
process.env['GIT_CONFIG_KEY_0'] = 'core.excludesFile';
process.env['GIT_CONFIG_VALUE_0'] = os.devNull;
process.env['GIT_CONFIG_KEY_1'] = 'core.attributesFile';
process.env['GIT_CONFIG_VALUE_1'] = os.devNull;
