/** Returns the opening marker of a delimited section in a markdown file. */
function openMarker(key: string): string {
  return `<!-- section:${key} -->`;
}

/** Returns the closing marker of a delimited section. */
function closeMarker(key: string): string {
  return `<!-- /section:${key} -->`;
}

/**
 * Replaces or inserts a delimited section in file content.
 *
 * When both markers exist in order, replaces the content between them. Otherwise, prepends the
 * section (with markers) at the top of the content.
 */
export function injectSection(content: string, key: string, injection: string): string {
  const openComment = openMarker(key);
  const closeComment = closeMarker(key);

  const openIndex = content.indexOf(openComment);
  const closeIndex = content.indexOf(closeComment);

  if (openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex) {
    const contentBefore = content.slice(0, openIndex + openComment.length);
    const contentAfter = content.slice(closeIndex);
    return `${contentBefore}\n${injection}\n${contentAfter}`;
  }

  const section = `${openComment}\n${injection}\n${closeComment}`;
  if (content.length === 0) {
    return `${section}\n`;
  }
  return `${section}\n\n${content}`;
}
