import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';

import { buildMonorepo } from './fixture-repo.ts';

/** Builds a fixture monorepo and points `process.cwd()` at it for the current test, which is what workspace discovery reads. */
export function useMonorepo(files: Record<string, string>): string {
  const dir = buildMonorepo(files);
  disposeOnTestFinished(pointCwdAt(dir));
  return dir;
}
