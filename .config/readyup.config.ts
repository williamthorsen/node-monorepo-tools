import { defineRdyConfig } from 'readyup';

/** Readyup configuration for this monorepo. */
export default defineRdyConfig({
  compile: {
    include: '*.ts',
  },
  internal: {
    dir: 'internal',
  },
});
