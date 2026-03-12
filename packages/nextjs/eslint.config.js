import path from 'node:path';

import { createConfig, patterns } from '@williamthorsen/eslint-config-typescript';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

import baseConfig from '../../eslint.config.js';

export default [
  ...baseConfig,
  ...tseslint.config({
    files: patterns.codeFiles.map((pattern) => path.join('src', pattern)),
    extends: [
      await createConfig.next(), //
      await createConfig.react(),
    ],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          js: 'never',
          jsx: 'never',
          ts: 'always',
          tsx: 'always',
        },
      ],
    },
    settings: {
      next: { rootDir: '.' },
      react: { version: '19.1.0' },
      vitest: { typecheck: true },
    },
  }),
  ...tseslint.config({
    files: patterns.codeFiles.map((pattern) => path.join('src', '**/__tests__', pattern)),
    extends: [await createConfig.reactTestingLibrary(), await createConfig.vitest()],
    rules: {
      'react/display-name': 'off', // Not needed in tests

      'testing-library/render-result-naming-convention': 'error',
      'testing-library/no-manual-cleanup': 'off', // Vitest does not clean up automatically after each test.

      'vitest/max-expects': 'off',
      'vitest/no-hooks': 'off',
      'vitest/padding-around-all': 'off',
      'vitest/padding-around-expect-groups': 'off',
      'vitest/prefer-expect-assertions': 'off',
    },
    settings: {
      'testing-library/custom-renders': 'off',
      vitest: { typecheck: true },
    },
  }),
  {
    files: ['**/next-env.d.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off', // Next generates a file that uses triple slashes
    },
  },
];
