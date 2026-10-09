import baseConfig, { commonIgnores, createConfig, toolIgnores } from '@williamthorsen/eslint-config-typescript';
import type { Linter } from 'eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

import { syntaxRestrictions, testCodeRestrictions } from './eslint.restrictions.ts';

const config = defineConfig([
  ...baseConfig,
  {
    // ESLint reports a stale `eslint-disable` without a rule name, and strict-lint promotes only named rules, so
    // raising it here fails the gate on one.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  // The revise-prose helper rewrites its record on every sweep, quoting a string as its YAML emitter chooses. A fixture
  // manifest describes a test app rather than a published package, so the package-json rules do not apply to it.
  globalIgnores([
    ...commonIgnores,
    ...toolIgnores,
    '.agents/revise-prose.yaml',
    '**/__tests__/fixtures/**/package.json',
  ]),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    rules: {
      'no-console': ['error', { allow: ['debug', 'info', 'warn'] }],
      'no-restricted-syntax': ['error', ...syntaxRestrictions],
    },
  },
  {
    files: ['**/__tests__/**', '**/test-utils/**'],
    rules: {
      'no-restricted-syntax': ['error', ...testCodeRestrictions],
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Anchor the project service (enabled by the base config) at the repo root.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-confusing-void-expression': [
        'warn',
        {
          ignoreArrowShorthand: true,
          ignoreVoidOperator: true,
          ignoreVoidReturningFunctions: true,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowBoolean: true,
          allowNumber: true,
        },
      ],
    },
  },
  defineConfig({
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [await createConfig.vitest()],
    rules: {
      // Assertions here run through helpers named `expectX` and `assertX`; without these patterns the rule reports
      // every test that uses one. `expect*` subsumes plain `expect`.
      'vitest/expect-expect': ['warn', { assertFunctionNames: ['expect*', 'assert*'] }],
      // Off upstream, re-enabled here: The `import()` form typechecks the specifier, so a moved or renamed module
      // fails the build instead of silently leaving the real module in place.
      'vitest/prefer-import-in-mock': 'warn',
      // Off here: The rule's hand-maintained `Symbol` allow-list omits `dispose`, which a suite-scoped
      // `captureStdio` binding calls to restore the streams, and the rule does not take any option to extend it.
      'unicorn/no-nonstandard-builtin-properties': 'off',
    },
  }),
  ...defineHostAgnosticBoundary('build-info', ['collect', 'vite']),
  ...defineHostAgnosticBoundary('change-grammar'),
  defineConfig({
    files: ['packages/build-info-react/src/**/*.{ts,tsx}'],
    extends: [await createConfig.react(), await createConfig.jsxA11y()],
  }),
  {
    // Keep every component renderable as a React Server Component: The source does not use hooks or context, does
    // not import `react-dom`, and does not mark itself as client-only. The suites render through `react-dom/server`.
    files: ['packages/build-info-react/src/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // The base config's own entry, which this block would otherwise drop.
            { group: ['node_modules/*'], message: 'Should not import from node_modules' },
            {
              importNamePattern: '^(use|createContext$)',
              message:
                'build-info-react components stay free of hooks and context, so that they render as Server Components.',
              regex: '^react$',
            },
            {
              message: 'build-info-react components render through whichever renderer the consumer uses.',
              regex: '^react-dom(/|$)',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...syntaxRestrictions,
        {
          message: 'build-info-react components render as Server Components as well as Client Components.',
          selector: "ExpressionStatement[directive='use client']",
        },
      ],
    },
  },
  {
    files: ['**/scripts/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
]);

export default config;

// region | Helpers

/**
 * Returns the blocks that keep a package depending on nothing but itself, so that it runs anywhere: Its source does
 * not import any module outside the package, any package, or any Node builtin, and it does not read `process`.
 *
 * Each of `nodeSideDirs`, a directory under `src`, is exempt from the dependency rules and may not be imported by the
 * rest of `src`, which keeps the host-agnostic entry free of anything that it reaches.
 */
function defineHostAgnosticBoundary(packageDir: string, nodeSideDirs: string[] = []): Linter.Config[] {
  const sourceDir = `packages/${packageDir}/src`;
  const outsideZone = {
    except: [`./packages/${packageDir}`],
    from: '.',
    message: `The ${packageDir} package imports nothing outside its own directory.`,
    target: `./${sourceDir}`,
  };
  const nodeSideZones = nodeSideDirs.map((dir) => ({
    from: `./${sourceDir}/${dir}`,
    message: `The host-agnostic source of ${packageDir} does not import its Node-side \`${dir}\` entry.`,
    target: `./${sourceDir}`,
  }));
  const nodeSideGlobs = nodeSideDirs.map((dir) => `${sourceDir}/${dir}/**/*.ts`);

  return [
    {
      files: [`${sourceDir}/**/*.ts`],
      ignores: nodeSideGlobs,
      rules: {
        'import-x/no-nodejs-modules': 'error',
        'import-x/no-restricted-paths': [
          'error',
          { basePath: import.meta.dirname, zones: [outsideZone, ...nodeSideZones] },
        ],
        'no-restricted-globals': [
          'error',
          { message: `The ${packageDir} package does not read the ambient environment.`, name: 'process' },
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                message: `The ${packageDir} package does not depend on any package, so it does not pass any dependency on to its consumers.`,
                regex: '^[^.]',
              },
            ],
          },
        ],
      },
    },
    ...(nodeSideGlobs.length > 0
      ? [
          {
            files: nodeSideGlobs,
            rules: {
              'import-x/no-restricted-paths': ['error', { basePath: import.meta.dirname, zones: [outsideZone] }],
            },
          } satisfies Linter.Config,
        ]
      : []),
    {
      // The package's suites stay outside the dependency half of the boundary, because they run ESLint through
      // Vitest and read the filesystem. The path zone still applies to them.
      files: [`${sourceDir}/**/__tests__/**/*.ts`],
      rules: {
        'import-x/no-nodejs-modules': 'off',
        'no-restricted-globals': 'off',
        'no-restricted-imports': 'off',
      },
    },
  ];
}

// endregion | Helpers
