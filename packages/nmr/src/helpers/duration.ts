/** Renders a duration at the coarsest unit that still says something, for a line a reader skims. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / MILLISECONDS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / MINUTES_PER_HOUR)}h`;
}

/**
 * Renders the marker a skip spends on the time it saved, or `undefined` when there is no saving worth naming.
 * A skip that can say what it saved earns the icon; one that cannot says nothing, and the caller drops its whole
 * clause rather than printing a saving of `~0s`.
 *
 * Guards its own input rather than trusting the caller's, because the marker is shared: a non-finite duration
 * compares false against the threshold, and would reach a reader as `saved ~NaNs`.
 */
export function formatSaving(milliseconds: number): string | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds < MILLISECONDS_PER_SECOND) {
    return undefined;
  }

  return `${SPEED_BOOST_ICON} saved ~${formatDuration(milliseconds)}`;
}

// region | Helpers

const MILLISECONDS_PER_SECOND = 1_000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

/** Proclaims a saving loudly enough to catch the eye in a run that scrolls. */
const SPEED_BOOST_ICON = '🚀';

// endregion | Helpers
