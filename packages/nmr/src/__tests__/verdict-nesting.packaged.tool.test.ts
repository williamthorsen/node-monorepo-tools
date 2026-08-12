import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

// Whether a level reports is decided by that level's own process, not by the one that composed it, so every
// case here spawns real child nmr processes. Those children run the built `nmr` on `PATH` rather than this
// source, which is what the `packaged` segment of the filename records: a stale `dist` fails these and nothing
// else.
describe('verdict nesting', () => {
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

// region | Helpers

/** Runs the CLI in-process against `cwd`, returning what it and every process below it wrote to stdout. */
async function runNmr(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string }> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env: readAmbientEnv(), stderr: new PassThrough(), stdout });

  return { exitCode, stdout: Buffer.concat(chunks).toString('utf8') };
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
