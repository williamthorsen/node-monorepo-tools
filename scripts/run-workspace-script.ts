/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

import { assertIsPackageJson } from './assertIsPackageJson.js';

const OK_CODE = 0;
const ERROR_CODE = 1;

const args = process.argv.slice(2);
const useIntTests = args.includes('--int-test');
const scripts = getScripts(useIntTests);

if (useIntTests) {
  args.shift();
}

const packageJson = getPackageJson();

function handleCommand(): void {
  if (args.length === 0) {
    showHelp(OK_CODE);
  }

  const key = args[0];
  const scripts = getScripts(useIntTests);

  if (!key || key === '-?' || key === '--help') {
    showHelp(OK_CODE);
  }

  if (key in scripts) {
    const overrideScript = getOverrideScript(key);
    if (overrideScript) {
      console.info(`Using override script: ${overrideScript}`);
    } else {
      if (typeof overrideScript === 'string') {
        console.info('Override script is defined but empty. Skipping script.');
        process.exit(OK_CODE);
      }
    }

    const standardScript = expandScript(scripts[key]);
    const script = overrideScript ?? standardScript;
    if (!script) {
      console.error(`Script not defined: ${key}`);
      process.exit(ERROR_CODE);
    }
    try {
      execSync(script, { stdio: 'inherit' });
    } catch {
      process.exit(ERROR_CODE);
    }
  } else {
    console.error(`Unknown script: ${key}`);
    process.exit(ERROR_CODE);
  }
}

function assertIsError(value: unknown): asserts value is Error {
  if (!(value instanceof Error)) {
    console.error(value);
    throw new TypeError('Expected an Error');
  }
}

function getOverrideScript(scriptName: string): string | undefined {
  return packageJson.scripts?.[scriptName];
}

/**
 * Returns the contents of `package.json` as an object.
 */
function getPackageJson() {
  const packageJsonPath = fs.realpathSync(process.cwd() + '/package.json');
  const content: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  try {
    assertIsPackageJson(content);
  } catch (error) {
    assertIsError(error);
    console.error(error.message);
    process.exit(ERROR_CODE);
  }
  return content;
}

function getScripts(useIntTests = false): Record<string, string | []> {
  const commonScripts: Record<string, string | string[]> = {
    build: ['compile', 'generate-typings'],
    check: ['typecheck', 'fmt:check', 'lint:check', 'test'],
    'check:strict': ['typecheck', 'fmt:check', 'lint:strict', 'test:coverage'],
    clean: 'pnpm exec rimraf dist/*',
    compile: 'tsx ../../config/build.ts',
    fmt: 'prettier --list-different --write .',
    'fmt:check': 'prettier --check .',
    'generate-typings': 'tsc --project tsconfig.generate-typings.json',
    lint: 'eslint --fix .',
    'lint:check': 'eslint .',
    'lint:strict': 'strict-lint',
    test: 'vitest',
    'test:coverage': 'vitest --coverage',
    'test:watch': 'vitest --watch',
    typecheck: 'tsgo --noEmit',
    'view-coverage': 'open coverage/index.html',
  };

  const integrationTestScripts = {
    test: 'pnpm exec vitest --config=vitest.standalone.config.ts',
    'test:coverage': 'pnpm exec vitest --config=vitest.standalone.config.ts --coverage',
    'test:integration': 'pnpm exec vitest --config=vitest.integration.config.ts',
    'test:watch': 'pnpm exec vitest --config=vitest.standalone.config.ts --watch',
  };

  const standardTestScripts = {
    test: 'pnpm exec vitest',
    'test:coverage': 'pnpm exec vitest --coverage',
    'test:watch': 'pnpm exec vitest --watch',
  };

  return {
    ...commonScripts,
    ...(useIntTests ? integrationTestScripts : standardTestScripts),
  };
}

function expandScript(script: string | string[] | undefined): string {
  if (!script) {
    return '';
  } else if (typeof script === 'string') {
    return script;
  } else {
    return script.map((s) => `pnpm run ws ${s}`).join(' && ');
  }
}

function describeScript(script: string | string[] | undefined): string {
  if (!script) {
    return '';
  }
  return typeof script === 'string' ? script : `pnpm run [${script.join(', ')}]`;
}

function showHelp(code: number): never {
  console.info('Usage: pnpm run ws {script}');
  console.info('Available scripts:');

  for (const [key, value] of Object.entries(scripts)) {
    console.info(`  ${key.padEnd(15)} ${describeScript(value)}`);
  }
  process.exit(code);
}

handleCommand();
