import { advisoryRuleSeverities } from '@williamthorsen/eslint-config-typescript';
import { defineConfig } from '@williamthorsen/strict-lint/config';

const config = defineConfig({
  // Keep the advisory rules as warnings; strict-lint otherwise promotes every warning to an error.
  maxSeverity: advisoryRuleSeverities,
});

export default config;
