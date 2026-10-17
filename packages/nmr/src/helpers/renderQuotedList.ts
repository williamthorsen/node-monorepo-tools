/** How many items a diagnostic lists before it reports the rest as a count. */
const LIST_CEILING = 10;

/** Renders a list of items for a diagnostic, backticked and capped so that a long list does not fill the terminal. */
export function renderQuotedList(items: readonly string[]): string {
  const shownItems = items
    .slice(0, LIST_CEILING)
    .map((item) => `\`${item}\``)
    .join(', ');
  const remainder = items.length - LIST_CEILING;

  return remainder > 0 ? `${shownItems}, and ${remainder} more` : shownItems;
}
