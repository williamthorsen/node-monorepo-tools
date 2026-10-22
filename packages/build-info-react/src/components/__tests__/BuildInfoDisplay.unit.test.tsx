import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildInfoDisplay } from '../BuildInfoDisplay.tsx';
import { buildFullBuildInfo, buildMinimalBuildInfo } from '../test-utils/build-info-fixtures.ts';

describe(BuildInfoDisplay, () => {
  it('renders the label followed by the release notes', () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildFullBuildInfo()} />);

    expect(markup).toMatch(/^<div class="build-info"><span class="build-info-label">.*<\/span><section /);
  });

  it('passes the heading level to the release notes', () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildFullBuildInfo()} headingLevel={4} />);

    expect(markup).toContain('<h4 class="build-info-release-notes-heading">');
  });

  it('passes shouldShowEnvironment to the label', () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildMinimalBuildInfo()} shouldShowEnvironment />);

    expect(markup).toContain('<span class="build-info-environment">development</span>');
  });

  it('omits the environment by default', () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildMinimalBuildInfo()} />);

    expect(markup).not.toContain('build-info-environment');
  });

  it('renders the label alone when the build does not have any release notes', () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildMinimalBuildInfo()} />);

    expect(markup).not.toContain('build-info-release-notes');
  });

  it("appends the consumer's class name to the root element", () => {
    const markup = renderToStaticMarkup(<BuildInfoDisplay info={buildMinimalBuildInfo()} className="site-build" />);

    expect(markup).toMatch(/^<div class="build-info site-build">/);
  });
});
