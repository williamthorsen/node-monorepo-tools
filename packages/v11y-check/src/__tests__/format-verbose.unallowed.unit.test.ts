import type { OutputStyle } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { formatCheckVerboseText } from '../format-verbose.ts';
import { buildPopulatedCheckResult } from '../test-utils/buildPopulatedCheckResult.ts';
import { makeCheckResult } from '../test-utils/check-result-fixtures.ts';

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

// -- formatCheckVerboseText: unallowed entries --

describe(formatCheckVerboseText, () => {
  it('renders "(none)" for an empty scope', () => {
    const result = makeCheckResult();
    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('-- \u{1F4E6} prod --');
    expect(output).toContain('  (none)');
  });

  it('renders an unallowed vulnerability with the failed marker, title, path, and link', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            ghsaId: 'GHSA-unallowed',
            id: '1234',
            path: 'lodash',
            paths: ['my-app>lodash'],
            severity: 'high',
            title: 'Prototype pollution in lodash',
            url: 'https://github.com/advisories/GHSA-unallowed',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{274C} GHSA-unallowed');
    expect(output).toContain('\u{1F534} high');
    expect(output).toContain('Prototype pollution in lodash');
    expect(output).toContain('path: my-app>lodash');
    expect(output).toContain('link: https://github.com/advisories/GHSA-unallowed');
  });

  it('falls back to numeric ID when ghsaId is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            id: '1234',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/1234',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{274C} 1234');
  });

  it('renders multi-path vulnerabilities with a plural "paths:" list', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-multi',
            path: 'lodash',
            paths: ['app>some-lib>lodash', 'app>other-lib>lodash'],
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-multi',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('paths:');
    expect(output).toContain('- app>some-lib>lodash');
    expect(output).toContain('- app>other-lib>lodash');
    expect(output).not.toMatch(/\bpath: /);
  });

  it('renders single-path vulnerabilities with a singular "path:" line', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-single',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/single',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('path: pkg');
    expect(output).not.toMatch(/paths:\s*\n/);
  });

  it('word-wraps description indented to the detail column', () => {
    const longDescription =
      'Merging user-controlled objects into a plain object can lead to prototype pollution, enabling attackers to modify Object.prototype.';
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            description: longDescription,
            id: 'GHSA-wrap',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/wrap',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('     Merging');
    // Check that the output does not put the whole description on a single line.
    const lines = output.split('\n');
    const veryLongLine = lines.find((line) => line.length > 90);
    expect(veryLongLine).toBeUndefined();
  });

  it('wraps an ASCII description at 72 columns of content', () => {
    const description =
      'Merging user-controlled objects into a plain object can lead to prototype pollution, enabling attackers to modify Object.prototype.';

    expect(listDescriptionLines(description)).toStrictEqual([
      '     Merging user-controlled objects into a plain object can lead to',
      '     prototype pollution, enabling attackers to modify Object.prototype.',
    ]);
  });

  it('wraps a CJK description by display columns', () => {
    // Each word is 4 characters and 8 columns, so 8 words and 7 spaces fill 71 of the 72 columns.
    const word = '\u{8106}\u{5F31}\u{6027}\u{3042}';
    const description = Array.from({ length: 20 }, () => word).join(' ');
    const fullLine = `     ${Array.from({ length: 8 }, () => word).join(' ')}`;

    expect(listDescriptionLines(description)).toStrictEqual([
      fullLine,
      fullLine,
      `     ${Array.from({ length: 4 }, () => word).join(' ')}`,
    ]);
  });

  it('wraps an emoji description by display columns', () => {
    // A ZWJ sequence is 5 UTF-16 code units and 2 columns, so a word of 4 is 8 columns.
    const word = '\u{1F469}\u{200D}\u{1F4BB}'.repeat(4);
    const description = Array.from({ length: 12 }, () => word).join(' ');

    expect(listDescriptionLines(description)).toStrictEqual([
      `     ${Array.from({ length: 8 }, () => word).join(' ')}`,
      `     ${Array.from({ length: 4 }, () => word).join(' ')}`,
    ]);
  });

  it('leaves a word wider than the content width whole on a line of its own', () => {
    const wideWord = '\u{8106}'.repeat(40);

    expect(listDescriptionLines(`before ${wideWord} after`)).toStrictEqual([
      '     before',
      `     ${wideWord}`,
      '     after',
    ]);
  });

  it('widens the indent in plain style and keeps 72 columns of content', () => {
    const description =
      'Merging user-controlled objects into a plain object can lead to prototype pollution, enabling attackers to modify Object.prototype.';

    expect(listDescriptionLines(description, 'plain')).toStrictEqual([
      '        Merging user-controlled objects into a plain object can lead to',
      '        prototype pollution, enabling attackers to modify Object.prototype.',
    ]);
  });

  it('preserves paragraph breaks in description', () => {
    const description = 'First paragraph.\n\nSecond paragraph.';
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            description,
            id: 'GHSA-paras',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/paras',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('First paragraph.');
    expect(output).toContain('Second paragraph.');
    const firstIdx = output.indexOf('First paragraph.');
    const secondIdx = output.indexOf('Second paragraph.');
    const between = output.slice(firstIdx, secondIdx);
    expect(between).toContain('\n\n');
  });

  it('omits description block when description is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-nodesc',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/nodesc',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    // Link is the last content line, followed by scope newline, not a description.
    expect(output).toContain('link: https://example.com/nodesc');
  });
});

// -- formatCheckVerboseText: plain style --

describe(`${formatCheckVerboseText.name} in plain style`, () => {
  it('does not print any pictographic character', () => {
    const output = formatCheckVerboseText(buildPopulatedCheckResult(), ['prod', 'dev'], 'plain', FIXED_NOW, {
      dev: 'high',
      prod: 'moderate',
    });

    expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('states each status in words and indents detail lines under the text after the marker', () => {
    const output = formatCheckVerboseText(buildPopulatedCheckResult(), ['prod'], 'plain', FIXED_NOW, {
      prod: 'moderate',
    });

    expect(output.split('\n').slice(0, 9)).toStrictEqual([
      '-- prod -- (threshold: moderate)',
      '  FAIL  GHSA-prod-unallowed  high',
      '        Unallowed advisory',
      '        path: lodash',
      '        link: https://github.com/advisories/GHSA-prod-unallowed',
      '',
      '        An unallowed advisory.',
      '',
      '  PASS  GHSA-prod-allowed  moderate  allowed 2 weeks ago (2026-04-01T00:00:00.000Z)',
    ]);
    expect(output).toContain('\n        reason: No fix is published.\n');
    expect(output).toContain('\n  STALE GHSA-prod-stale  not needed\n');
    expect(output).toContain('\n  SKIP  GHSA-prod-low  low  ignored (below threshold)\n');
  });
});

describe(`${formatCheckVerboseText.name} in rich style`, () => {
  it('marks each block with one glyph, its status', () => {
    const output = formatCheckVerboseText(buildPopulatedCheckResult(), ['prod'], 'rich', FIXED_NOW, {
      prod: 'moderate',
    });

    expect(output).toContain('\n  \u{274C} GHSA-prod-unallowed  \u{1F534} high\n     Unallowed advisory\n');
    expect(output).toContain('\n  \u{2705} GHSA-prod-allowed  \u{1F7E0} moderate  allowed 2 weeks ago');
    expect(output).toContain('\n  \u{1F9F9} GHSA-prod-stale  not needed\n');
    expect(output).toContain('\n  \u{23E9} GHSA-prod-low  \u{1F7E1} low  ignored (below threshold)\n');
  });
});

// region | Helpers
/** Lists the lines that a description occupies in the verbose output of a single unallowed entry. */
function listDescriptionLines(description: string, style: OutputStyle = 'rich'): string[] {
  const result = makeCheckResult({
    prod: {
      allowed: [],
      belowThreshold: [],
      stale: [],
      unallowed: [{ description, id: 'GHSA-wrap', path: 'pkg', paths: ['pkg'], url: 'https://example.com/wrap' }],
    },
  });
  const lines = formatCheckVerboseText(result, ['prod'], style, FIXED_NOW).split('\n');
  const linkIndex = lines.findIndex((line) => line.includes('link: '));
  // A blank line separates the link from the description, and another ends the block.
  return lines.slice(linkIndex + 2, lines.indexOf('', linkIndex + 2));
}
// endregion | Helpers
