import { execSync } from 'node:child_process';

/** The shell operations that release-kit runs, each throwing when the command fails. */
export interface Shell {
  /** Runs a shell command line with its output on the terminal. */
  run(command: string): void;
}

/** The `Shell` that runs commands through the system shell in the process's working directory. */
export const realShell: Shell = {
  run: (command) => {
    execSync(command, { stdio: 'inherit' });
  },
};
