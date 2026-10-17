import { reportError } from '@williamthorsen/nmr-core';

import type { Invocation, RunCliResult } from './invocation.ts';
import { isDelegationFlag, type ParsedArgs } from './invocation-args.ts';
import { OUTPUT_STYLE_ENV_VAR } from './output-style.ts';
import { reportVerdict } from './presentation.ts';
import {
  DELEGATION_FAILURE_EXIT_CODE,
  formatMisplacedDelegationWarning,
  resolveDelegationTarget,
  runRemotely,
} from './remote-run.ts';
import { createSnapshot } from './remote-snapshot.ts';
import { REPORT_FORMAT_ENV_VAR } from './report-format.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from './verbosity.ts';
import type { Verdict, VerdictOutcome } from './verdict.ts';

/**
 * Runs the invocation on the host that `--delegate` or `NMR_DELEGATE` names, and reports one verdict for the whole
 * delegation, its connection, transfer, and install included. Returns `undefined` when the invocation runs here.
 *
 * A tree that cannot be snapshotted is refused when the flag asked for the host, and runs here, with a line saying
 * why, when the variable did.
 */
export async function runOnDelegateHost(invocation: Invocation): Promise<RunCliResult | undefined> {
  const { command, context, cwd, env, format, parsedArgs, scope, stderr, stdout, styles } = invocation;

  // A delegation flag past the command name is an argument to the command, so the command runs wherever the flags
  // before it say. Without this warning, the developer would believe that it ran elsewhere.
  if (parsedArgs.passthrough.some(isDelegationFlag)) {
    stderr.write(`${formatMisplacedDelegationWarning(command, styles.stderr)}
`);
  }

  const target = resolveDelegationTarget({
    command,
    env,
    flagHost: parsedArgs.delegateHost,
    isOptedOut: parsedArgs.shouldRunLocally,
    isReading: parsedArgs.shouldPrintLog,
  });
  if (target.kind === 'local') {
    return undefined;
  }
  if (target.kind === 'refused') {
    reportError(target.error, stderr);
    return { exitCode: 1 };
  }

  const { host } = target;
  const startedAtMs = Date.now();
  const snapshot = createSnapshot(cwd, env);
  if (!snapshot.ok && snapshot.isUnsupported) {
    if (target.source === 'flag') {
      reportError(`Cannot delegate to ${host}: ${snapshot.reason}`, stderr);
      return { exitCode: 1 };
    }
    stderr.write(`nmr: running ${command} here rather than on ${host}: ${snapshot.reason}\n`);
    return undefined;
  }

  const result = snapshot.ok
    ? await runRemotely({
        command,
        cwd,
        env,
        host,
        monorepoRoot: context.monorepoRoot,
        nmrArgs: composeForwardedArgs(command, parsedArgs),
        remoteEnv: {
          [COMMAND_VERBOSITY_ENV_VAR]: invocation.verbosity,
          [OUTPUT_STYLE_ENV_VAR]: styles.stdout,
          [REPORT_FORMAT_ENV_VAR]: format,
        },
        snapshot,
        stderr,
        stdout,
      })
    : { ok: false as const, message: 'could not snapshot the working tree', output: snapshot.reason, waitedMs: 0 };
  const durationMs = Date.now() - startedAtMs - result.waitedMs;

  if (!result.ok) {
    if (result.output.trim() !== '') {
      stderr.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
    const verdict: Verdict = {
      command,
      detail: result.message,
      durationMs,
      exitCode: DELEGATION_FAILURE_EXIT_CODE,
      host,
      outcome: 'failed',
      scope,
    };
    reportVerdict(verdict, stdout, format, styles.stdout);
    return { exitCode: DELEGATION_FAILURE_EXIT_CODE };
  }

  const outcome: VerdictOutcome =
    result.exitCode === 0
      ? { outcome: 'passed', durationMs }
      : { outcome: 'failed', durationMs, exitCode: result.exitCode };
  reportVerdict({ command, host, scope, ...outcome }, stdout, format, styles.stdout);

  return { exitCode: result.exitCode };
}

// region | Helpers

/**
 * Returns the arguments with which the host runs the invocation: nmr's own flags that decide what runs and how it
 * reports, then the command and its arguments. The output style travels in the environment instead, resolved for
 * this terminal rather than for the host's pipe.
 */
function composeForwardedArgs(command: string, parsedArgs: ParsedArgs): string[] {
  return [
    ...(parsedArgs.filter === undefined ? [] : ['--filter', parsedArgs.filter]),
    ...(parsedArgs.recursive ? ['--recursive'] : []),
    ...(parsedArgs.isWorkspaceRoot ? ['--workspace-root'] : []),
    ...(parsedArgs.quiet ? ['--quiet'] : []),
    ...(parsedArgs.shouldEmitJson ? ['--json'] : []),
    ...(parsedArgs.shouldBypassCache ? ['--no-cache'] : []),
    ...(parsedArgs.shouldBypassLock ? ['--no-lock'] : []),
    command,
    ...parsedArgs.passthrough,
  ];
}

// endregion | Helpers
