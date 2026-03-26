import process from 'node:process';

import { main } from '../cli.ts';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`preflight: unexpected error: ${message}\n`);
  process.exit(1);
});
