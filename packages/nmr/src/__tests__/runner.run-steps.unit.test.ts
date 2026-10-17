import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';
import {
  collect,
  createRedirectedStream,
  createTerminalStream,
  endChild,
  flushEventLoop,
  readStdioFromCall,
} from '../test-utils/fake-spawn.ts';

vi.mock(import('node:child_process'), () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

const OPAQUE_STEP: Step = { kind: 'opaque', command: 'eslint .' };
const STRUCTURAL_STEP: Step = { kind: 'structural', argv: ['nmr', '-w', 'typecheck'] };
const WITHHOLDING_STEP: Step = {
  kind: 'structural',
  argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'],
  shouldWithholdInput: true,
};

describe(runSteps, () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  describe('sequencing', () => {
    it('runs every step when each succeeds', async () => {
      stubSequence([0, 0, 0]);

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledTimes(3);
    });

    it('stops at the first non-zero exit and returns that code', async () => {
      stubSequence([0, 2, 0]);

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(2);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    });

    it('runs the steps in the order given', async () => {
      stubSequence([0, 0]);

      await runSteps([OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(readFilesFromCalls()).toStrictEqual(['eslint .', 'nmr']);
    });

    it('given an empty step list, exits 0 without spawning', async () => {
      stubSequence([]);

      const result = await runSteps([], undefined, { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(result).toStrictEqual({ exitCode: 0 });
      expect(mockedSpawn).not.toHaveBeenCalled();
    });
  });

  describe('spawning', () => {
    it('hands an opaque step to a shell as one command line', async () => {
      stubSequence([0]);

      await runSteps([OPAQUE_STEP], '/repo', { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(mockedSpawn.mock.calls[0]?.slice(0, 2)).toStrictEqual(['eslint .', []]);
      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ cwd: '/repo', shell: true });
    });

    it('spawns a structural step by argv, so a shell does not read its arguments', async () => {
      stubSequence([0]);

      await runSteps([{ kind: 'structural', argv: ['nmr', 'test', '-t', 'a b'] }], '/repo', {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(mockedSpawn.mock.calls[0]?.slice(0, 2)).toStrictEqual(['nmr', ['test', '-t', 'a b']]);
      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ shell: false });
    });
  });

  describe('channels', () => {
    it.each([
      { expectedStdio: [1, 1], isQuiet: false, scenario: 'a loud run' },
      { expectedStdio: [1, 1], isQuiet: true, scenario: 'a quiet run' },
    ])('given $scenario, hands a structural step nmr descriptors', async ({ expectedStdio, isQuiet }) => {
      stubSequence([0]);

      await runSteps([STRUCTURAL_STEP], undefined, {
        quiet: isQuiet,
        stderr: Object.assign(new PassThrough(), { fd: 1 }),
        stdout: Object.assign(new PassThrough(), { fd: 1 }),
      });

      expect(readStdioFromCall().slice(1)).toStrictEqual(expectedStdio);
    });

    it('falls back to a pipe for a structural step when the stream does not have a descriptor', async () => {
      stubSequence([0]);

      await runSteps([STRUCTURAL_STEP], undefined, { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(readStdioFromCall().slice(1)).toStrictEqual(['pipe', 'pipe']);
    });

    it('withholds an opaque step under quiet, because a descriptor would leave nothing to withhold', async () => {
      stubSequence([0]);

      await runSteps([OPAQUE_STEP], undefined, {
        quiet: true,
        stderr: createTerminalStream(),
        stdout: createTerminalStream(),
      });

      expect(readStdioFromCall().slice(1)).toStrictEqual(['pipe', 'pipe']);
    });

    it.each([
      { expectedStdin: 'ignore', scenario: 'a structural step that withholds input', step: WITHHOLDING_STEP },
      { expectedStdin: 'inherit', scenario: 'a structural step', step: STRUCTURAL_STEP },
      { expectedStdin: 'inherit', scenario: 'an opaque step', step: OPAQUE_STEP },
    ])('given $scenario, gives the child stdin $expectedStdin', async ({ expectedStdin, step }) => {
      stubSequence([0]);

      await runSteps([step], undefined, { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(readStdioFromCall()[0]).toBe(expectedStdin);
    });
  });

  describe('background steps', () => {
    const BACKGROUND_STEP: Step = { kind: 'structural', argv: ['nmr', 'lint'], shouldRunInBackground: true };

    it('pipes a background step and withholds stdin, even when nmr writes to a terminal', async () => {
      stubSequence([0, 0]);

      await runSteps([BACKGROUND_STEP, STRUCTURAL_STEP], undefined, {
        stderr: createTerminalStream(),
        stdout: createTerminalStream(),
      });

      expect(mockedSpawn.mock.calls[0]?.[2].stdio).toStrictEqual(['ignore', 'pipe', 'pipe']);
      expect(mockedSpawn.mock.calls[1]?.[2].stdio).toStrictEqual(['inherit', 1, 1]);
    });

    it.each([
      { env: {}, expected: '1', scenario: 'nmr writes to a terminal', stdout: createTerminalStream },
      { env: {}, expected: undefined, scenario: 'nmr writes to a redirect', stdout: createRedirectedStream },
      { env: { NO_COLOR: '1' }, expected: undefined, scenario: 'NO_COLOR is set', stdout: createTerminalStream },
      { env: { FORCE_COLOR: '0' }, expected: '0', scenario: 'FORCE_COLOR is inherited', stdout: createTerminalStream },
    ])('when $scenario, gives the background step FORCE_COLOR $expected', async ({ env, expected, stdout }) => {
      stubSequence([0, 0]);

      await runSteps([BACKGROUND_STEP, STRUCTURAL_STEP], undefined, {
        env: { PATH: '/bin', ...env },
        stderr: createTerminalStream(),
        stdout: stdout(),
      });

      expect(mockedSpawn.mock.calls[0]?.[2].env?.['FORCE_COLOR']).toBe(expected);
      expect(mockedSpawn.mock.calls[1]?.[2].env).toStrictEqual({ PATH: '/bin', ...env });
    });

    it('prints a background step after the foreground step during which it ended', async () => {
      stubSequence([0, 0], [{ stdout: 'background\n' }, { stdout: 'foreground\n' }]);
      const stdout = new PassThrough();
      const received = collect(stdout);

      await runSteps([BACKGROUND_STEP, OPAQUE_STEP], undefined, { stderr: new PassThrough(), stdout });

      expect(received().toString('utf8')).toBe('foreground\nbackground\n');
    });

    it('reports a failing background step when the foreground passes', async () => {
      stubSequence([3, 0]);

      const result = await runSteps([BACKGROUND_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(3);
    });

    it('reports the failing foreground step over a failing background step', async () => {
      stubSequence([3, 2]);

      const result = await runSteps([BACKGROUND_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(2);
    });
  });

  describe('retention', () => {
    it('returns what an opaque step wrote, each stream apart from the other', async () => {
      stubSequence([0], [{ stderr: 'a warning\n', stdout: 'a summary\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retainedOutput?.stdout.toString('utf8')).toBe('a summary\n');
      expect(result.retainedOutput?.stderr.toString('utf8')).toBe('a warning\n');
    });

    it('concatenates several opaque steps per stream in declaration order', async () => {
      stubSequence([0, 0], [{ stdout: 'first\n' }, { stdout: 'second\n' }]);

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retainedOutput?.stdout.toString('utf8')).toBe('first\nsecond\n');
    });

    // A composite hands its descriptors to the nmr processes below it, and a destination without one makes
    // those steps piped like any other, so the kind is the only thing that separates them.
    it('given a list of structural steps alone, retains nothing even though they ran on pipes', async () => {
      stubSequence([0, 0], [{ stdout: 'a constituent verdict\n' }, { stdout: 'another verdict\n' }]);

      const result = await runSteps([STRUCTURAL_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retainedOutput).toBeUndefined();
    });

    it('given hooks wrapped around the command, retains the command output alone', async () => {
      stubSequence([0, 0, 0], [{ stdout: 'before\n' }, { stdout: 'the command\n' }, { stdout: 'after\n' }]);

      const result = await runSteps(
        [
          { kind: 'structural', argv: ['nmr', 'check:pre'] },
          OPAQUE_STEP,
          { kind: 'structural', argv: ['nmr', 'check:post'] },
        ],
        undefined,
        { stderr: new PassThrough(), stdout: new PassThrough() },
      );

      expect(result.retainedOutput?.stdout.toString('utf8')).toBe('the command\n');
    });

    it('given a stream handed to the child as a descriptor, retains nothing', async () => {
      stubSequence([0], [{ stdout: 'a summary\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: createTerminalStream(),
        stdout: createTerminalStream(),
      });

      expect(result.retainedOutput).toBeUndefined();
    });

    it('given one opaque step captured and another handed a descriptor, retains nothing', async () => {
      let call = 0;
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // The second step is the one whose stderr goes to a descriptor, which leaves a capture of stdout alone.
        const isPartial = call === 1;
        call++;
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fakeChild = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: isPartial || stdio[2] !== 'pipe' ? null : new PassThrough(),
        });
        setImmediate(() => {
          fakeChild.stdout?.write('a summary\n');
          void endChild(fakeChild, 0);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
        return fakeChild as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retainedOutput).toBeUndefined();
    });

    it('given a failing step, still returns what ran', async () => {
      stubSequence([1], [{ stdout: 'the failure\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.retainedOutput?.stdout.toString('utf8')).toBe('the failure\n');
    });
  });

  describe('quiet mode', () => {
    // Each process suppresses the output of the command that it runs, never of the subtree beneath it: The nmr
    // process spawned by a structural step does its own withholding, so this one forwards whatever it receives.
    it('forwards a structural step even under quiet', async () => {
      const destination = new PassThrough();
      const received = collect(destination);
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fakeChild = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        setImmediate(() => {
          fakeChild.stdout?.write('a child verdict\n');
          void endChild(fakeChild, 0);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
        return fakeChild as unknown as ReturnType<typeof spawn>;
      });

      await runSteps([STRUCTURAL_STEP], undefined, {
        quiet: true,
        stderr: new PassThrough(),
        stdout: destination,
      });
      await flushEventLoop();

      expect(received().toString('utf8')).toBe('a child verdict\n');
    });

    it('reports the output of the failing step alone, leaving an earlier step that it already withheld unreported', async () => {
      const errorStream = new PassThrough();
      const reported = collect(errorStream);
      let index = 0;
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fakeChild = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        const step = index;
        index++;
        setImmediate(() => {
          fakeChild.stdout?.write(step === 0 ? 'first step chatter\n' : 'second step failure\n');
          void endChild(fakeChild, step === 0 ? 0 : 1);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
        return fakeChild as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      await flushEventLoop();

      expect(result.exitCode).toBe(1);
      expect(reported().toString('utf8')).toBe('second step failure\n');
    });
  });

  describe('spawn failure', () => {
    it('ends the sequence rather than running on to the next step', async () => {
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fakeChild = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        setImmediate(() => fakeChild.emit('error', new Error('spawn nmr ENOENT')));
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
        return fakeChild as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result).toStrictEqual({ exitCode: 1 });
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });
  });
});

// region | Helpers

/** What one step of a stubbed sequence writes before it exits. */
interface StepOutput {
  stderr?: string;
  stdout?: string;
}

/** Reads the file passed to each spawn, in call order. */
function readFilesFromCalls(): (string | undefined)[] {
  return mockedSpawn.mock.calls.map((call) => call[0]);
}

/**
 * Installs a spawn mock that ends each child as soon as it is created, taking each exit code and each step's
 * output from the queues in turn. A step list runs to completion without the test driving every child by hand.
 */
function stubSequence(exitCodes: readonly number[], outputs: readonly StepOutput[] = []): void {
  let index = 0;

  mockedSpawn.mockImplementation((_file, _args, options) => {
    const stdio = Array.isArray(options.stdio) ? options.stdio : [];
    // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
    const fakeChild = Object.assign(new EventEmitter(), {
      stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
      stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
    });
    const exitCode = exitCodes[index] ?? 0;
    const output = outputs[index] ?? {};
    index++;
    setImmediate(() => {
      if (output.stdout !== undefined) fakeChild.stdout?.write(output.stdout);
      if (output.stderr !== undefined) fakeChild.stderr?.write(output.stderr);
      void endChild(fakeChild, exitCode);
    });
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
    return fakeChild as unknown as ReturnType<typeof spawn>;
  });
}

// endregion | Helpers
