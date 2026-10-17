import process from 'node:process';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { OutputChannels } from '../output-channel.ts';
import { runCommand, runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';
import { collect } from '../test-utils/fake-spawn.ts';

const PRODUCED_BYTES = 2_000_000;

/** The SIGTERM listeners present before any step list runs, which a finished list must leave as it found them. */
const listenerCountBefore = process.listenerCount('SIGTERM');

/** What a caller writing to a non-terminal destination resolves, which is the arrangement that these tests model. */
const PIPED_CHANNELS: OutputChannels = { stderr: 'pipe', stdout: 'pipe' };

describe(runCommand, () => {
  it('when a command writes past 1 MiB, passes and forwards every byte', async () => {
    const destination = new PassThrough();
    const received = collect(destination);

    const result = await runCommand(
      `"${process.execPath}" -e "process.stdout.write('a'.repeat(${PRODUCED_BYTES}))"`,
      undefined,
      { channels: PIPED_CHANNELS, stderr: new PassThrough(), stdout: destination },
    );

    expect(result).toMatchObject({ exitCode: 0, outcome: 'exited' });
    expect(received()).toHaveLength(PRODUCED_BYTES);
    expect(result.stdout).toHaveLength(PRODUCED_BYTES);
  });

  it('when a descendant holds the output pipe open, resolves on the exit status without waiting for it', async () => {
    const destination = new PassThrough();
    const received = collect(destination);
    const startedAtMs = Date.now();

    // `sleep` inherits the pipe and outlives the shell, so the pipe never closes on its own.
    const result = await runCommand('sleep 20 & echo ready', undefined, {
      channels: PIPED_CHANNELS,
      stderr: new PassThrough(),
      stdout: destination,
    });

    expect(result).toMatchObject({ exitCode: 0, outcome: 'exited' });
    expect(received().toString('utf8')).toContain('ready');
    expect(Date.now() - startedAtMs).toBeLessThan(10_000);
  }, 30_000);
});

describe(runSteps, () => {
  it('runs a background step alongside the steps after it', async () => {
    const startedAtMs = Date.now();

    const result = await runSteps(
      [background(nodeStep('setTimeout(() => {}, 1500)')), nodeStep('setTimeout(() => {}, 1500)')],
      undefined,
      {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(Date.now() - startedAtMs).toBeLessThan(2_500);
  });

  it('prints a background step whole, after the foreground output during which it wrote', async () => {
    const stdout = new PassThrough();
    const received = collect(stdout);

    await runSteps(
      [
        background(nodeStep(`console.log('bg-a'); setTimeout(() => console.log('bg-b'), 200)`)),
        nodeStep(`console.log('fg-a'); setTimeout(() => console.log('fg-b'), 600)`),
      ],
      undefined,
      { stderr: new PassThrough(), stdout },
    );

    expect(received().toString('utf8')).toBe('fg-a\nfg-b\nbg-a\nbg-b\n');
  });

  it('when the foreground fails, still waits for the background step and prints it', async () => {
    const stdout = new PassThrough();
    const received = collect(stdout);

    const result = await runSteps(
      [
        background(nodeStep(`setTimeout(() => console.log('bg-done'), 500)`)),
        nodeStep('process.exit(2)'),
        nodeStep(`console.log('never')`),
      ],
      undefined,
      { stderr: new PassThrough(), stdout },
    );

    expect(result.exitCode).toBe(2);
    expect(received().toString('utf8')).toBe('bg-done\n');
  });

  it('when a foreground step dies by a signal, ends the background step with it', async () => {
    const startedAtMs = Date.now();

    const result = await runSteps(
      [background(nodeStep('setTimeout(() => {}, 20000)')), nodeStep(`process.kill(process.pid, 'SIGTERM')`)],
      undefined,
      { stderr: new PassThrough(), stdout: new PassThrough() },
    );

    expect(result.exitCode).toBe(143);
    expect(Date.now() - startedAtMs).toBeLessThan(5_000);
  }, 30_000);

  // Emitting the event stands in for a signal sent to nmr's pid alone, which reaches nmr's listeners but no child.
  it('when nmr receives SIGTERM, forwards it to every running step', async () => {
    const startedAtMs = Date.now();

    const running = runSteps(
      [background(nodeStep('setTimeout(() => {}, 20000)')), nodeStep('setTimeout(() => {}, 20000)')],
      undefined,
      { stderr: new PassThrough(), stdout: new PassThrough() },
    );
    setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 500);
    const result = await running;

    expect(result.exitCode).toBe(143);
    expect(Date.now() - startedAtMs).toBeLessThan(5_000);
    expect(process.listenerCount('SIGTERM')).toBe(listenerCountBefore);
  }, 30_000);
});

/** Builds a structural step that runs a Node script directly, as a nested nmr process would be run. */
function nodeStep(script: string): Step & { kind: 'structural' } {
  return { kind: 'structural', argv: [process.execPath, '-e', script] };
}

/** Marks a step to run in the background. */
function background(step: Step & { kind: 'structural' }): Step {
  return { ...step, shouldRunInBackground: true };
}
