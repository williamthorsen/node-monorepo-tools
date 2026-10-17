import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckOutcome, RdyCheck } from 'readyup';
import { fileExists, isRecord, readFile, readPackageJson } from 'readyup/check-utils';

import { getDefaultRootScripts } from '../../src/resolve-scripts.ts';
import { formatPaths, readFileIn } from './repo-files.ts';

/** Root scripts that `pnpm install` runs, in the order that it runs them. */
const INSTALL_LIFECYCLE_SCRIPTS = [
  'pnpm:devPreinstall',
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
];

const LEFTHOOK_CHECK_INSTALL_PATTERN = /\blefthook\s+check-install\b/;

const LEFTHOOK_INSTALL_PATTERN = /\blefthook\s+install\b/;

export const rootScriptChecks: RdyCheck[] = [
  {
    name: 'root package.json has no nmr-provided scripts',
    severity: 'warn',
    quiet: true,
    check: noRedundantRootScripts,
    fix: 'Remove scripts from root package.json that nmr provides as built-in root scripts, and invoke them through nmr directly',
  },
];

export const gitHookChecks: RdyCheck[] = [
  {
    name: 'no root install script runs lefthook install unguarded',
    severity: 'warn',
    quiet: true,
    check: () => noUnguardedLefthookInstall(),
    fix: "Guard each listed script as `lefthook check-install || lefthook install`, which writes hooks only when they are missing or stale. A bare `lefthook install` rewrites `.git/hooks` on every install, so when that directory is not writable, as in an agent's sandbox, `pnpm install` fails and pnpm's `verifyDepsBeforeRun` then reinstalls before every `pnpm exec`",
  },
];

export const legacyRunnerChecks: RdyCheck[] = [
  {
    name: 'scripts/run-workspace-script.ts does not exist',
    severity: 'error',
    quiet: true,
    check: () => !fileExists('scripts/run-workspace-script.ts'),
    fix: 'Delete scripts/run-workspace-script.ts, because nmr replaces this custom script runner',
  },
  {
    name: 'no workspace packages reference run-workspace-script or "pnpm run ws"',
    severity: 'error',
    quiet: true,
    check: noWorkspaceRunScriptReferences,
    fix: 'Remove "ws" script entries and replace any "pnpm run ws" invocations with nmr in each packages/*/package.json',
  },
];

/**
 * Checks that the root scripts that `pnpm install` runs do not invoke `lefthook install` without
 * `lefthook check-install`.
 *
 * Any `check-install` in the script counts as the guard, so an `if !` spelling passes and an unusual spelling
 * errs toward a false negative. A script run by hand is out of scope, because forcing a reinstall is its purpose.
 *
 * @internal - Exported only to enable testing
 */
export function noUnguardedLefthookInstall(cwd: string = process.cwd()): boolean | CheckOutcome {
  const scripts = readRootScripts(cwd);
  const unguardedScripts = INSTALL_LIFECYCLE_SCRIPTS.flatMap((name) => {
    const command = scripts[name];
    if (typeof command !== 'string') return [];
    const isUnguarded = LEFTHOOK_INSTALL_PATTERN.test(command) && !LEFTHOOK_CHECK_INSTALL_PATTERN.test(command);
    return isUnguarded ? `${name}: ${command}` : [];
  });

  if (unguardedScripts.length === 0) return true;
  return { ok: false, detail: formatPaths(unguardedScripts) };
}

// region | Helpers

/** Checks that root package.json does not define any scripts that duplicate nmr built-in root scripts. */
function noRedundantRootScripts(): boolean | CheckOutcome {
  const pkg = readPackageJson();
  if (!pkg) return true;
  const scripts = pkg['scripts'];
  if (!isRecord(scripts)) return true;

  const builtInNames = Object.keys(getDefaultRootScripts(process.cwd()));
  const redundantNames = Object.keys(scripts).filter((name) => builtInNames.includes(name));

  if (redundantNames.length === 0) return true;
  return {
    ok: false,
    detail: `redundant: ${redundantNames.join(', ')}`,
  };
}

/** Checks that workspace package.json files do not reference run-workspace-script or "pnpm run ws". */
function noWorkspaceRunScriptReferences(): boolean | CheckOutcome {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) return true;

  const legacyPattern = /run-workspace-script|"pnpm\s+run\s+ws\b/;
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const content = readFile(`packages/${entry.name}/package.json`);
    if (content && legacyPattern.test(content)) {
      matches.push(entry.name);
    }
  }

  if (matches.length === 0) return true;
  return {
    ok: false,
    detail: `found in: ${matches.join(', ')}`,
  };
}

/**
 * Returns the root manifest's `scripts`, or an empty record when the manifest is absent, does not parse, or does
 * not declare a scripts object. A malformed manifest is not this check's to report.
 */
function readRootScripts(cwd: string): Record<string, unknown> {
  const content = readFileIn(cwd, 'package.json');
  if (content === undefined) return {};

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(content);
  } catch {
    return {};
  }

  if (!isRecord(parsedManifest)) return {};
  const scripts = parsedManifest['scripts'];
  return isRecord(scripts) ? scripts : {};
}

// endregion | Helpers
