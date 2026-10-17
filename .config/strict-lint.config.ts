import { advisoryRuleSeverities } from '@williamthorsen/eslint-config-typescript';
import { defineConfig } from '@williamthorsen/strict-lint/config';

const config = defineConfig({
  // Keep the advisory rules as warnings; strict-lint otherwise promotes every warning to an error. `max-lines` is
  // promoted, because the tree is clean of it and a new oversized file should fail the build.
  maxSeverity: { ...advisoryRuleSeverities, 'max-lines': 'error' },
});

export default config;
