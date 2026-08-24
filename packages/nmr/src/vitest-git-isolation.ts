/**
 * Vitest setup file that keeps the developer's git config out of the git subprocesses a test spawns.
 *
 * A suite that runs `git` otherwise reads the ambient identity and signing settings, so it passes against
 * whatever the developer happens to have configured and can block outright on a signing passphrase.
 *
 * `defineVitestConfig` loads this into every project by default; see nmr's `isolateGit` option.
 */
import os from 'node:os';

// The null device reads as an empty config file, which is what leaves git with no global or system settings at all.
process.env['GIT_CONFIG_GLOBAL'] = os.devNull;
process.env['GIT_CONFIG_SYSTEM'] = os.devNull;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';
