/**
 * Vitest setup file that keeps the developer's and the machine's git configuration out of the git subprocesses
 * spawned by a test.
 *
 * A suite that runs `git` otherwise reads the ambient identity, signing settings, ignore rules, and attributes, so
 * it passes against whatever the developer or the machine happens to have configured and can block outright on a
 * signing passphrase.
 *
 * `defineVitestConfig` loads this into every project by default; see nmr's `isolateGit` option.
 */
import os from 'node:os';

// The null device reads as an empty config file, which is what leaves git with no global or system settings at all.
process.env['GIT_CONFIG_GLOBAL'] = os.devNull;
process.env['GIT_CONFIG_SYSTEM'] = os.devNull;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

// The system attributes file at `$(prefix)/etc/gitattributes` is reached by no config variable, and
// `GIT_ATTR_NOSYSTEM` is its only lever. The variable appears in neither `git(1)` nor `gitattributes(5)`, so a git
// that stops honoring it leaves that one file readable rather than failing.
process.env['GIT_ATTR_NOSYSTEM'] = '1';

// The per-user excludes and attributes files survive the three config variables: neither path is config-derived,
// so git resolves each from `$XDG_CONFIG_HOME/git/`, or from `~/.config/git/` where that variable is unset,
// whatever the config says. `GIT_CONFIG_GLOBAL` already replaces `$XDG_CONFIG_HOME/git/config`, so those two are
// the rest of what that directory supplies. Injecting the keys through the environment reaches them without
// redirecting `XDG_CONFIG_HOME`, which other tools spawned by a test read for configuration of their own: pnpm
// fails to start where that variable points at the null device.
process.env['GIT_CONFIG_COUNT'] = '2';
process.env['GIT_CONFIG_KEY_0'] = 'core.excludesFile';
process.env['GIT_CONFIG_VALUE_0'] = os.devNull;
process.env['GIT_CONFIG_KEY_1'] = 'core.attributesFile';
process.env['GIT_CONFIG_VALUE_1'] = os.devNull;
