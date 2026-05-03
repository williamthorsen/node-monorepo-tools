// Copy the work-types JSON canonical and schema into the build output so the published package can
// resolve them at runtime via `import.meta.url`. Invoked by the `build:post` npm script; expects the
// package root as cwd (which is what npm scripts provide).

import { copyFileSync } from 'node:fs';

copyFileSync('src/work-types.json', 'dist/esm/work-types.json');
copyFileSync('src/work-types.schema.json', 'dist/esm/work-types.schema.json');
