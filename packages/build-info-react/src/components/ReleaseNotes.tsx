import type { BuildInfoReleaseNotes } from '@williamthorsen/build-info';
import type { ReactElement } from 'react';

import { joinClassNames } from './joinClassNames.ts';

/** The level of the heading that introduces each release-notes section. */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface ReleaseNotesProps {
  notes: BuildInfoReleaseNotes | undefined;
  /** The level of each section's heading, so that it fits the page's outline. Defaults to 3. */
  headingLevel?: HeadingLevel | undefined;
  /** Appended to the root element's `build-info-release-notes` class. */
  className?: string | undefined;
}

/**
 * A build's release notes: each section as a heading and a list of its items' descriptions, or the raw markdown in a
 * `<pre>` when the notes are not divided into sections. Renders nothing when the build does not have any notes.
 */
export function ReleaseNotes({ notes, headingLevel = 3, className }: ReleaseNotesProps): ReactElement | null {
  if (notes === undefined) {
    return null;
  }

  const Heading = `h${headingLevel}` as const;

  return (
    <section className={joinClassNames('build-info-release-notes', className)}>
      {notes.sections === undefined ? (
        <pre className="build-info-release-notes-markdown">{notes.markdown}</pre>
      ) : (
        notes.sections.map((section) => (
          <div className="build-info-release-notes-section" key={section.title}>
            <Heading className="build-info-release-notes-heading">{section.title}</Heading>
            <ul className="build-info-release-notes-items">
              {section.items.map((item, index) => (
                // Key by position: The list is static, and two items can share a description.
                <li className="build-info-release-notes-item" key={index}>
                  {item.description}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
