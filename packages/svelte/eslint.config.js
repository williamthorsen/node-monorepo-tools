// References:
// - https://github.com/sveltejs/eslint-plugin-svelte3
// - https://codechips.me/eslint-svelte-typescript/

import baseConfig from '../../eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['*.svelte'],
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        extraFileExtensions: ['.svelte'],
        project: ['./tsconfig.eslint.json'],
      },
    },
    plugins: ['svelte3'],
    processor: 'svelte3/svelte3',
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-ignore': 'allow',
        },
      ],
    },
    settings: {
      'svelte3/typescript': true, // load TypeScript as peer dependency
    },
  },
];
