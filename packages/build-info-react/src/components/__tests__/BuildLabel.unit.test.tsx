import { formatBuildLabel } from '@williamthorsen/build-info';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildLabel } from '../BuildLabel.tsx';
import { buildFullBuildInfo, buildMinimalBuildInfo } from '../test-utils/build-info-fixtures.ts';

describe(BuildLabel, () => {
  it('links the short SHA to the commit when the build records a GitHub repository', () => {
    const markup = renderToStaticMarkup(<BuildLabel info={buildFullBuildInfo()} />);

    expect(markup).toBe(
      '<span class="build-info-label">' +
        '<span class="build-info-version">v0.7.0</span> · ' +
        '<a class="build-info-commit" href="https://github.com/acme/web/commit/a59f2f8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a">a59f2f8</a> · ' +
        '<time class="build-info-time" dateTime="2026-10-08T06:29:41.123Z">2026-10-08 06:29Z</time>' +
        '</span>',
    );
  });

  it('shows the short SHA without a link when the repository is not on GitHub', () => {
    const info = buildFullBuildInfo();
    const repository = { provider: 'gitlab', owner: 'acme', name: 'web', url: 'https://gitlab.com/acme/web' };

    const markup = renderToStaticMarkup(<BuildLabel info={{ ...info, repository }} />);

    expect(markup).toContain('<span class="build-info-commit">a59f2f8</span>');
    expect(markup).not.toContain('<a ');
  });

  it('omits the commit segment when the build does not record a commit', () => {
    const markup = renderToStaticMarkup(<BuildLabel info={buildMinimalBuildInfo()} />);

    expect(markup).not.toContain('build-info-commit');
  });

  it.for([
    ['with a commit', buildFullBuildInfo()],
    ['without a commit', buildMinimalBuildInfo()],
  ] as const)('shows the same text as formatBuildLabel %s', ([, info]) => {
    expect(readText(renderToStaticMarkup(<BuildLabel info={info} />))).toBe(formatBuildLabel(info));
  });

  it("appends the consumer's class name to the root element", () => {
    const markup = renderToStaticMarkup(<BuildLabel info={buildMinimalBuildInfo()} className="footer-label" />);

    expect(markup).toMatch(/^<span class="build-info-label footer-label">/);
  });
});

// region | Helpers

/** Returns the text that the markup displays, without its tags. */
function readText(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, '');
}

// endregion | Helpers
