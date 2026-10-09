import { type BuildInfo, getBuildLabelParts, getCommitUrl } from '@williamthorsen/build-info';
import type { ReactElement } from 'react';

import { joinClassNames } from './joinClassNames.ts';

export interface BuildLabelProps {
  info: BuildInfo;
  /** Appended to the root element's `build-info-label` class. */
  className?: string | undefined;
}

/** Separates the label's segments, so that its text matches `formatBuildLabel`. */
const SEPARATOR = ' · ';

/**
 * The build's one-line label: its version, its short commit SHA, which links to the commit when the build records a
 * GitHub repository, and its build time.
 */
export function BuildLabel({ info, className }: BuildLabelProps): ReactElement {
  const { version, shortSha, time } = getBuildLabelParts(info);
  const commitUrl = getCommitUrl(info);

  return (
    <span className={joinClassNames('build-info-label', className)}>
      <span className="build-info-version">{version}</span>
      {shortSha !== undefined && (
        <>
          {SEPARATOR}
          {commitUrl === undefined ? (
            <span className="build-info-commit">{shortSha}</span>
          ) : (
            <a className="build-info-commit" href={commitUrl}>
              {shortSha}
            </a>
          )}
        </>
      )}
      {SEPARATOR}
      <time className="build-info-time" dateTime={info.buildTime}>
        {time}
      </time>
    </span>
  );
}
