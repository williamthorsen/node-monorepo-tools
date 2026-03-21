/**
 * Report monorepo dependency overrides after install.
 *
 * Guard on the built file existing: on a fresh clone, core's `prepare` script
 * has not yet run, so the CLI binary is not available. The `bootstrap` script
 * handles that case.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const reportOverridesPath = resolve('packages/core/dist/esm/cli-report-overrides.js');

if (existsSync(reportOverridesPath)) {
  await import(pathToFileURL(reportOverridesPath).href);
}
