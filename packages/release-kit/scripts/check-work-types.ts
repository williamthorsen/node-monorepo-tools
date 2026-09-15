// Reports drift between the package's `src/work-types.json` and the upstream codeassembly canonical.

import { checkWorkTypesDrift } from './checkWorkTypesDrift.ts';
import { WORK_TYPES_JSON_PATH } from './workTypesUtils.ts';

const result = await checkWorkTypesDrift(WORK_TYPES_JSON_PATH);
if (result.exitCode === 0) {
  console.info(result.message);
} else {
  process.stderr.write(`${result.message}\n`);
}
process.exitCode = result.exitCode;
