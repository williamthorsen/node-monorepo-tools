import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** Result of one audit-ci run. */
export interface AuditCiRunResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
}

/** Runs audit-ci with the given arguments in the given directory. */
export type AuditCiRunner = (args: readonly string[], cwd: string) => AuditCiRunResult;

/** Resolves the audit-ci binary path from node_modules. */
export function resolveAuditCiBin(): string {
  try {
    const resolvedUrl = import.meta.resolve('audit-ci');
    const modulePath = new URL(resolvedUrl).pathname;
    // audit-ci v7 publishes its CLI at dist/bin.js
    const packageDir = modulePath.replace(/\/dist\/.*$/, '');
    return `${packageDir}/dist/bin.js`;
  } catch {
    return 'audit-ci';
  }
}

/** Spawns the resolved audit-ci bin under the current Node executable and captures its output. */
export function runAuditCi(args: readonly string[], cwd: string): AuditCiRunResult {
  const result = spawnSync(process.execPath, [resolveAuditCiBin(), ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const runResult: AuditCiRunResult = {
    signal: result.signal,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
  if (result.error) runResult.error = result.error;
  return runResult;
}
