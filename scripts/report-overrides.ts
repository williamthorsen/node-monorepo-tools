/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { isObject } from '@williamthorsen/toolbelt.objects';

import packageJson from '../package.json' with { type: 'json' };

type PackageJson = typeof packageJson & {
  pnpm?: { overrides: Record<string, string> };
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

function hasPnpmWithOverrides(pkg: PackageJson): pkg is typeof packageJson & {
  pnpm: {
    overrides: Record<string, string>;
  };
} {
  return isObject(pkg.pnpm) && isStringRecord(pkg.pnpm.overrides);
}

const overrides = hasPnpmWithOverrides(packageJson) ? packageJson.pnpm.overrides : {};

if (Object.keys(overrides).length === 0) {
  process.exit(0);
}

console.warn('🔒 WARN: pnpm overrides are active! Check whether these are still needed:');
for (const [name, version] of Object.entries(overrides)) {
  if (typeof version !== 'string') continue; // type guard only
  console.warn(`- ${name} → ${version}`);
}
