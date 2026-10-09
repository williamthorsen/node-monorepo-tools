import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReleaseNotes } from '../ReleaseNotes.tsx';

const SECTIONED_NOTES = {
  markdown: '## Features\n\n- Add the build label\n',
  sections: [{ title: 'Features', items: [{ description: 'Add the build label', body: 'Shown in the footer.' }] }],
};

describe(ReleaseNotes, () => {
  it("renders each section as a heading and a list of its items' descriptions", () => {
    const markup = renderToStaticMarkup(<ReleaseNotes notes={SECTIONED_NOTES} />);

    expect(markup).toBe(
      '<section class="build-info-release-notes">' +
        '<div class="build-info-release-notes-section">' +
        '<h3 class="build-info-release-notes-heading">Features</h3>' +
        '<ul class="build-info-release-notes-items"><li class="build-info-release-notes-item">Add the build label</li></ul>' +
        '</div>' +
        '</section>',
    );
  });

  it('renders section headings at the requested level', () => {
    const markup = renderToStaticMarkup(<ReleaseNotes notes={SECTIONED_NOTES} headingLevel={2} />);

    expect(markup).toContain('<h2 class="build-info-release-notes-heading">Features</h2>');
  });

  it('renders the markdown in a <pre> when the notes are not divided into sections', () => {
    const markup = renderToStaticMarkup(<ReleaseNotes notes={{ markdown: '- Fix the footer' }} />);

    expect(markup).toBe(
      '<section class="build-info-release-notes"><pre class="build-info-release-notes-markdown">- Fix the footer</pre></section>',
    );
  });

  it('renders nothing when the build does not have any notes', () => {
    expect(renderToStaticMarkup(<ReleaseNotes notes={undefined} />)).toBe('');
  });

  it("appends the consumer's class name to the root element", () => {
    const markup = renderToStaticMarkup(<ReleaseNotes notes={SECTIONED_NOTES} className="changelog" />);

    expect(markup).toMatch(/^<section class="build-info-release-notes changelog">/);
  });
});
