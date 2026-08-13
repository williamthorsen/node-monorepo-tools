import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

// What a level reports is decided by that level's own process, not by the one that composed it, so every case
// here spawns real child nmr processes. Those children run the built `nmr` on `PATH` rather than this source,
// which is what the `packaged` segment of the filename records: a stale `dist` fails these and nothing else.
describe('reporting through a real chain', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'nmr-verdict-nesting-'));
    writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nesting-root', private: true }));
    mkdirSync(path.join(repo, '.config'), { recursive: true });
    writeFileSync(
      path.join(repo, '.config', 'nmr.config.ts'),
      `export default ${JSON.stringify({
        rootScripts: {
          boom: 'echo boom-noise && exit 1',
          colorful: String.raw`printf '\033[32mcolored-noise\033[39m\n'`,
          demo: 'echo main-noise',
          'demo:content': 'echo content-noise',
          'demo:one': 'echo one-noise',
          'demo:post': ['demo:content'],
          'demo:two': 'echo two-noise',
          fanout: ['demo:one', 'demo:two'],
        },
      })};\n`,
    );
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe('nesting', () => {
    it('lets each element of a composite report through the quiet ancestor nmr composed', async () => {
      const { exitCode, stdout } = await runNmr(['-q', 'fanout'], repo);

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('noise');
      expect(verdictCommands(stdout)).toStrictEqual(['demo:one', 'demo:two', 'fanout']);
    });

    it('reports a delegating hook under the name it delegates to, and never under its own', async () => {
      const { exitCode, stdout } = await runNmr(['-q', 'demo'], repo);

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('noise');
      expect(verdictCommands(stdout)).toStrictEqual(['demo:content', 'demo']);
    });
  });

  describe('machine-readable reporting', () => {
    it.each([
      { args: ['--json', 'fanout'], overrides: {}, scenario: 'the flag' },
      { args: ['fanout'], overrides: { [REPORT_FORMAT_ENV_VAR]: 'json' }, scenario: 'an inherited value' },
    ])(
      'given $scenario, reports one JSON object per command and nothing else on stdout',
      async ({ args, overrides }) => {
        const { exitCode, stdout } = await runNmr(args, repo, overrides);

        expect(exitCode).toBe(0);
        expect(parseRecords(stdout).map((record) => record['command'])).toStrictEqual([
          'demo:one',
          'demo:two',
          'fanout',
        ]);
      },
    );

    it("withholds the commands' own output on both streams where every one of them passed", async () => {
      const { stderr, stdout } = await runNmr(['--json', 'fanout'], repo);

      expect(stdout).not.toContain('noise');
      expect(stderr).not.toContain('noise');
    });

    it("surrenders a failing command's output on stderr, leaving stdout parseable", async () => {
      const { exitCode, stderr, stdout } = await runNmr(['--json', 'boom'], repo);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('boom-noise');
      expect(parseRecords(stdout)).toMatchObject([{ command: 'boom', exitCode: 1, outcome: 'failed' }]);
    });

    it('lets no escape sequence a command wrote reach the stream', async () => {
      const { stdout } = await runNmr(['--json', 'colorful'], repo);

      expect(stdout).not.toContain('\u{1B}');
      expect(parseRecords(stdout)).toMatchObject([{ command: 'colorful', outcome: 'passed' }]);
    });
  });
});

// region | Helpers

/** Reports whether a parsed line is a JSON object, which every record nmr emits is. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses every line a machine-readable run wrote to stdout, throwing on one that is not a JSON object.
 *
 * A stray prose line is what this is here to catch, so it fails the test rather than being filtered away: an
 * assertion matching text instead would pass on a stream a consumer could not read.
 */
function parseRecords(stdout: string): Record<string, unknown>[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) {
        throw new Error(`Expected a JSON object on stdout, got: ${line}`);
      }

      return parsed;
    });
}

/**
 * Runs the CLI in-process against `cwd`, returning what it and every process below it wrote to each stream.
 * The overrides are added to the ambient environment, which has nmr's own variables stripped from it.
 */
async function runNmr(
  args: string[],
  cwd: string,
  overrides: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const errorChunks: Buffer[] = [];
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => {
    errorChunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env: { ...readAmbientEnv(), ...overrides }, stderr, stdout });

  return {
    exitCode,
    stderr: Buffer.concat(errorChunks).toString('utf8'),
    stdout: Buffer.concat(chunks).toString('utf8'),
  };
}

/** Reads the command each verdict line names, in the order the lines arrived. */
function verdictCommands(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => /^\S+ [^:]+: (?<command>\S+): (?:passed|failed|skipped)/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => match.groups?.['command'] ?? '');
}

// endregion | Helpers
