import { describe, expect, it } from 'vitest';

import { generateHelp } from '../src/help.js';

describe('generateHelp', () => {
  it('includes usage line', () => {
    const help = generateHelp({});
    expect(help).toContain('Usage: nmr [flags] <command> [args...]');
  });

  it('includes all flag descriptions', () => {
    const help = generateHelp({});
    expect(help).toContain('-F, --filter');
    expect(help).toContain('-R, --recursive');
    expect(help).toContain('-w, --workspace-root');
    expect(help).toContain('-?, --help');
    expect(help).toContain('--int-test');
  });

  it('includes workspace commands section', () => {
    const help = generateHelp({});
    expect(help).toContain('Workspace commands:');
    expect(help).toContain('build');
    expect(help).toContain('test');
    expect(help).toContain('typecheck');
  });

  it('includes root commands section', () => {
    const help = generateHelp({});
    expect(help).toContain('Root commands:');
    expect(help).toContain('ci');
    expect(help).toContain('report-overrides');
  });

  it('includes config-defined scripts', () => {
    const help = generateHelp({
      workspaceScripts: { 'copy-content': 'tsx scripts/copy-content.ts' },
      rootScripts: { 'demo:catwalk': 'pnpx http-server' },
    });

    expect(help).toContain('copy-content');
    expect(help).toContain('demo:catwalk');
  });
});
