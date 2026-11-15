import { execFileSync } from 'node:child_process';

/** The package-manager operations that release-kit runs, each throwing when the package manager fails. */
export interface PackageManagerCli {
  /** Runs `executable` with the publish arguments `args` in `cwd`, with its output on the terminal. */
  publish(executable: string, args: readonly string[], cwd: string): void;
}

/** The `PackageManagerCli` that runs the package manager's own executable. */
export const realPackageManagerCli: PackageManagerCli = {
  publish: (executable, args, cwd) => {
    execFileSync(executable, args, { cwd, stdio: 'inherit' });
  },
};
