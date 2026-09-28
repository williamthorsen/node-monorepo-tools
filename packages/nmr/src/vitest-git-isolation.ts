/**
 * Vitest setup file that keeps the developer's and the machine's git configuration out of the git subprocesses
 * spawned by a test.
 *
 * A suite that runs `git` otherwise reads the ambient identity, signing settings, ignore rules, and attributes, so
 * it passes against whatever the developer or the machine happens to have configured and can block outright on a
 * signing passphrase.
 *
 * `defineVitestConfig` loads this into every project by default; see nmr's `shouldIsolateGit` option.
 */
import os from 'node:os';

// The null device reads as an empty config file, which leaves git without any global or system settings at all.
process.env['GIT_CONFIG_GLOBAL'] = os.devNull;
process.env['GIT_CONFIG_SYSTEM'] = os.devNull;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

// The system attributes file at `$(prefix)/etc/gitattributes` is not reached by any config variable, and
// `GIT_ATTR_NOSYSTEM` is the only setting that controls it. The variable appears in neither `git(1)` nor
// `gitattributes(5)`, so a git that stops honoring it leaves that one file readable rather than failing.
process.env['GIT_ATTR_NOSYSTEM'] = '1';

// The three config variables leave the per-user excludes and attributes files in effect: Because neither path is
// config-derived, git resolves each from `$XDG_CONFIG_HOME/git/`, or from `~/.config/git/` when that variable is
// unset, whatever the config says. `GIT_CONFIG_GLOBAL` already replaces `$XDG_CONFIG_HOME/git/config`, which leaves
// those two as the rest of what that directory supplies. Injecting the keys through the environment redirects them
// without redirecting `XDG_CONFIG_HOME`, which other tools spawned by a test read for configuration of their own:
// pnpm fails to start when that variable points at the null device.
process.env['GIT_CONFIG_COUNT'] = '2';
process.env['GIT_CONFIG_KEY_0'] = 'core.excludesFile';
process.env['GIT_CONFIG_VALUE_0'] = os.devNull;
process.env['GIT_CONFIG_KEY_1'] = 'core.attributesFile';
process.env['GIT_CONFIG_VALUE_1'] = os.devNull;
