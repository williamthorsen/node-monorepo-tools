import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT_BYTES } from '@williamthorsen/nmr-core';

/** Returns the arguments of the `gh release create` that publishes `tag` with `notes` as its body. */
export function buildReleaseCreateArgs(tag: string, notes: string): string[] {
  return ['release', 'create', tag, '--title', tag, '--notes', notes];
}

/** The gh operations that release-kit runs, each throwing when gh fails unless it states otherwise. */
export interface Gh {
  /** Creates a GitHub Release for `tag`, titled with the tag, with gh's output on the terminal. */
  createRelease(tag: string, notes: string): void;
  /** Reports whether the `gh` CLI can be run; never throws. */
  isAvailable(): boolean;
  /** Triggers the workflow defined by `workflowFile`, with gh's output on the terminal. */
  runWorkflow(workflowFile: string): void;
}

/** The `Gh` that runs the `gh` CLI in the process's working directory. */
export const realGh: Gh = {
  createRelease: (tag, notes) => {
    execFileSync('gh', buildReleaseCreateArgs(tag, notes), { stdio: 'inherit' });
  },
  isAvailable: () => {
    try {
      execFileSync('gh', ['--version'], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },
  runWorkflow: (workflowFile) => {
    execFileSync('gh', ['workflow', 'run', workflowFile], { stdio: 'inherit' });
  },
};
