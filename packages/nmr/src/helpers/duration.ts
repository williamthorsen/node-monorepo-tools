/**
 * Renders a duration at the two coarsest units that say something, for a line a reader skims.
 *
 * Truncates at every unit rather than rounding, so a value never reads as more time than elapsed: 90 seconds is
 * `1m 30s`, where rounding would claim `2m`. Below a minute the tenth is kept, since that is the scale at which
 * one check's runtime differs from another's; a whole number sheds the `.0` rather than reading `12.0s`.
 */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, milliseconds);

  if (total < MILLISECONDS_PER_MINUTE) {
    return `${truncateToTenth(total)}s`;
  }

  const totalMinutes = Math.floor(total / MILLISECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    const seconds = Math.floor(total / MILLISECONDS_PER_SECOND) % SECONDS_PER_MINUTE;
    return joinUnits(`${totalMinutes}m`, seconds, 's');
  }

  return joinUnits(`${Math.floor(totalMinutes / MINUTES_PER_HOUR)}h`, totalMinutes % MINUTES_PER_HOUR, 'm');
}

/**
 * Renders the clause a skip spends on the time it saved, or `undefined` when there is no saving worth naming.
 * A skip that can say what it saved earns the clause; one that cannot says nothing, and the caller drops it
 * rather than printing a saving of `~0s`.
 *
 * Guards its own input rather than trusting the caller's, because the clause is shared: a non-finite duration
 * compares false against the threshold, and would reach a reader as `saved ~NaNs`.
 */
export function formatSaving(milliseconds: number): string | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds < MILLISECONDS_PER_SECOND) {
    return undefined;
  }

  return `saved ~${formatDuration(milliseconds)}`;
}

// region | Helpers

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_SECOND = 1_000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

/** Appends the minor unit to the major one, dropping it when it is zero so `4m` never reads `4m 0s`. */
function joinUnits(major: string, minor: number, minorUnit: string): string {
  return minor === 0 ? major : `${major} ${minor}${minorUnit}`;
}

/**
 * Renders whole milliseconds as seconds truncated to a tenth, shedding a trailing `.0`.
 *
 * Divides the integer count rather than truncating a seconds float, whose binary representation puts 0.3 just
 * under three tenths and would render it `0.2s`.
 */
function truncateToTenth(milliseconds: number): number {
  return Math.floor(milliseconds / 100) / 10;
}

// endregion | Helpers
