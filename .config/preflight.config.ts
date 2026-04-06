import { definePreflightConfig } from '@williamthorsen/preflight';

/** Preflight configuration for this monorepo. */
export default definePreflightConfig({
  compile: {
    include: '*.ts',
  },
});
