// Overwrites the package's `src/work-types.json` with the upstream codeassembly canonical.

import { syncWorkTypes } from './syncWorkTypes.ts';
import { WORK_TYPES_JSON_PATH } from './workTypesUtils.ts';

const result = await syncWorkTypes(WORK_TYPES_JSON_PATH);
if (result.exitCode === 0) {
  console.info(result.message);
} else {
  process.stderr.write(`${result.message}\n`);
}
process.exitCode = result.exitCode;
