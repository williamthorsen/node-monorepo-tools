import type { BuildInfo } from '@williamthorsen/build-info';
import type { ReactElement } from 'react';

import { BuildLabel } from './BuildLabel.tsx';
import { joinClassNames } from './joinClassNames.ts';
import { type HeadingLevel, ReleaseNotes } from './ReleaseNotes.tsx';

export interface BuildInfoDisplayProps {
  info: BuildInfo;
  /** The level of each release-notes section's heading. Defaults to 3. */
  headingLevel?: HeadingLevel | undefined;
  /** Appended to the root element's `build-info` class. */
  className?: string | undefined;
}

/** A build's identity: its one-line label followed by its release notes, when it has any. */
export function BuildInfoDisplay({ info, headingLevel, className }: BuildInfoDisplayProps): ReactElement {
  return (
    <div className={joinClassNames('build-info', className)}>
      <BuildLabel info={info} />
      <ReleaseNotes notes={info.releaseNotes} headingLevel={headingLevel} />
    </div>
  );
}
