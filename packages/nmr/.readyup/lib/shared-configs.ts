import type { CheckOutcome, RdyCheck } from 'readyup';
import { isRecord } from 'readyup/check-utils';

import { CONFIG_EXTENSIONS, findFiles, formatPaths, importsSharedExport, readFileIn } from './repo-files.ts';

const SHARED_PRETTIER_MODULE = '@williamthorsen/nmr/prettier';

/** Prettier config forms that contain data rather than code, so none of them can call a factory. */
const INERT_PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.{json,json5,yaml,yml,toml}'];

const SHARED_TAZE_MODULE = '@williamthorsen/nmr/taze';

/** taze config forms that contain data rather than code. None of them can call a factory. */
const INERT_TAZE_CONFIGS = ['.tazerc', '.tazerc.json', 'taze.config.json'];

/**
 * taze options that a config file cannot set, each paired with the pattern that finds a declaration discarded by
 * taze. Its CLI writes a default for every one of them into the options that it merges over the config file.
 *
 * `concurrency` and `requestTimeout` lose whatever the file declares, so the key alone is the finding. The other
 * three have a CLI default equal to taze's own. Only a departure from it is lost, and matching the key alone would
 * report a setting that taze receives intact.
 */
const CLOBBERED_TAZE_OPTIONS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: 'concurrency', pattern: /\bconcurrency\s*:/ },
  { key: 'githubActions', pattern: /\bgithubActions\s*:\s*(?:false|\{)/ },
  { key: 'ignoreOtherWorkspaces', pattern: /\bignoreOtherWorkspaces\s*:\s*false/ },
  { key: 'nodeVersion', pattern: /\bnodeVersion\s*:\s*false/ },
  { key: 'requestTimeout', pattern: /\brequestTimeout\s*:/ },
];

export const prettierChecks: RdyCheck[] = [
  {
    name: 'Prettier config builds on @williamthorsen/nmr/prettier',
    severity: 'error',
    check: () => prettierConfigBuildsOnSharedConfig(),
    fix: "Replace the Prettier config with: import { definePrettierConfig } from '@williamthorsen/nmr/prettier'; export default definePrettierConfig();",
  },
];

export const tazeChecks: RdyCheck[] = [
  {
    name: 'taze.config.ts builds on @williamthorsen/nmr/taze',
    severity: 'warn',
    check: () => tazeConfigBuildsOnSharedConfig(),
    fix: "Replace the taze config with: import { defineConfig } from '@williamthorsen/nmr/taze'; export default defineConfig(); -- nmr's upgrade policy applies to a repo only through this file, so without it `nmr upgrade` does not report a dependency pinned to an exact version",
  },
  {
    name: 'taze config declares no option taze discards',
    severity: 'warn',
    quiet: true,
    check: () => tazeConfigAvoidsClobberedOptions(),
    fix: "Set these through the upgrade script instead, as rootScripts: { upgrade: 'nmr-report-overrides && nmr-taze --recursive --request-timeout 90000' } in .config/nmr.config.ts, keeping the rest of the default script. taze's CLI writes a default for each of them over whatever the config file declares, so taze never uses the file's value (antfu-collective/taze#317). nmr already forwards a 30-second request timeout",
  },
];

/**
 * Checks that the repo's Prettier config is built on the shared config from nmr.
 *
 * Both naming families count: Prettier reads `.prettierrc.js` and `prettier.config.js` alike, and matching
 * only the latter would report a conformant repo as stale. A config in one of the data-only forms fails
 * rather than being skipped: It cannot call a factory at all, so skipping would read as conformant when
 * the repo is in fact the furthest from it.
 *
 * @internal - Exported only to enable testing
 */
export function prettierConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles(
    [`.prettierrc.${CONFIG_EXTENSIONS}`, `prettier.config.${CONFIG_EXTENSIONS}`], //
    cwd,
  );

  if (configs.length === 0) {
    return { ok: false, detail: describeMissingPrettierConfig(cwd) };
  }

  const staleConfigs = configs.filter(
    (relativePath) =>
      !importsSharedExport(readFileIn(cwd, relativePath), 'definePrettierConfig', SHARED_PRETTIER_MODULE),
  );
  if (staleConfigs.length === 0) return true;
  return {
    ok: false,
    detail: `does not import definePrettierConfig from ${SHARED_PRETTIER_MODULE}: ${staleConfigs.join(', ')}`,
  };
}

/**
 * Checks that the repo's taze config does not declare an option that taze's CLI discards.
 *
 * Reports the setting rather than the file, because the fix is per option: Each one moves onto the upgrade
 * script, which passes it to taze as a flag. A repo declaring none of them is already in the passing state.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigAvoidsClobberedOptions(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);
  const findings: string[] = [];

  for (const relativePath of configs) {
    const content = readFileIn(cwd, relativePath);
    if (content === undefined) continue;

    const discardedKeys = CLOBBERED_TAZE_OPTIONS.filter(({ pattern }) => pattern.test(content)).map(({ key }) => key);
    if (discardedKeys.length > 0) findings.push(`${relativePath}: ${discardedKeys.join(', ')}`);
  }

  if (findings.length === 0) return true;
  return { ok: false, detail: formatPaths(findings) };
}

/**
 * Checks that the repo's taze config is present and built on the shared config from nmr.
 *
 * Absence fails rather than skipping: taze does not read any config at all without one, so the repo
 * silently loses the pair of settings that report a dependency pinned to a bare version. A config in one of the
 * data-only forms fails the same way, being unable to call a factory.
 *
 * @internal - Exported only to enable testing
 */
export function tazeConfigBuildsOnSharedConfig(cwd: string = process.cwd()): boolean | CheckOutcome {
  const configs = findFiles([`taze.config.${CONFIG_EXTENSIONS}`], cwd);

  if (configs.length === 0) {
    return { ok: false, detail: describeMissingTazeConfig(cwd) };
  }

  const staleConfigs = configs.filter(
    (relativePath) => !importsSharedExport(readFileIn(cwd, relativePath), 'defineConfig', SHARED_TAZE_MODULE),
  );
  if (staleConfigs.length === 0) return true;
  return { ok: false, detail: `does not import defineConfig from ${SHARED_TAZE_MODULE}: ${staleConfigs.join(', ')}` };
}

// region | Helpers

/** Names the data-only config standing in for an executable one, so that the fix says what to convert. */
function describeMissingPrettierConfig(cwd: string): string {
  const inertConfigs = findFiles(INERT_PRETTIER_CONFIGS, cwd);
  if (inertConfigs.length > 0) return `does not contain code that calls the factory: ${inertConfigs.join(', ')}`;

  if (hasPrettierConfigKey(cwd)) {
    return 'does not contain code that calls the factory: the "prettier" key in package.json';
  }

  return '.prettierrc.js is missing';
}

/** Names the data-only config standing in for an executable one, so that the fix says what to convert. */
function describeMissingTazeConfig(cwd: string): string {
  const inertConfigs = findFiles(INERT_TAZE_CONFIGS, cwd);
  if (inertConfigs.length > 0) return `does not contain code that calls the factory: ${inertConfigs.join(', ')}`;

  return 'taze.config.ts is missing';
}

/**
 * Reports whether `package.json` configures Prettier through its own top-level key.
 *
 * Parsed rather than pattern-matched, because `prettier` also appears as a dependency entry in every repo against
 * which this check runs (`nmr fmt` requires it as a peer), and a line-anchored pattern cannot tell the two depths
 * apart.
 */
function hasPrettierConfigKey(cwd: string): boolean {
  const manifest = readFileIn(cwd, 'package.json');
  if (manifest === undefined) return false;

  try {
    const parsedManifest: unknown = JSON.parse(manifest);
    return isRecord(parsedManifest) && parsedManifest['prettier'] !== undefined;
  } catch {
    return false;
  }
}

// endregion | Helpers
