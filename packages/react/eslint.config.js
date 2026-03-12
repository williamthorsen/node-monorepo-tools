import reactPlugin from 'eslint-plugin-react';

import baseConfig from '../../eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.tsx'],
    languageOptions: {
      globals: {
        JSX: 'readonly',
      },
    },
    plugins: {
      react: reactPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'no-undef': 'off',
      'react/react-in-jsx-scope': 'off', // disabled because React 17 doesn't need React to be in scope
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
