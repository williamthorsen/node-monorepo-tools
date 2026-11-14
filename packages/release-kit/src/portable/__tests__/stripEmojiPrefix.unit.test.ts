import { describe, expect, it } from 'vitest';

import { stripEmojiPrefix } from '../stripEmojiPrefix.ts';

describe(stripEmojiPrefix, () => {
  it('strips a leading single-codepoint emoji and the following space', () => {
    expect(stripEmojiPrefix('🐛 Bug fixes')).toBe('Bug fixes');
    expect(stripEmojiPrefix('🎉 Features')).toBe('Features');
    expect(stripEmojiPrefix('⚡ Performance')).toBe('Performance');
  });

  it('strips an emoji that includes a U+FE0F variation selector', () => {
    expect(stripEmojiPrefix('🗑️ Deprecated')).toBe('Deprecated');
    expect(stripEmojiPrefix('🏗️ Internal')).toBe('Internal');
    expect(stripEmojiPrefix('♻️ Refactoring')).toBe('Refactoring');
  });

  it('returns the input unchanged when the input does not have an emoji prefix', () => {
    expect(stripEmojiPrefix('Bug fixes')).toBe('Bug fixes');
    expect(stripEmojiPrefix('Internal')).toBe('Internal');
    expect(stripEmojiPrefix('')).toBe('');
  });

  it('does not strip an emoji that is not followed by a space', () => {
    expect(stripEmojiPrefix('🐛Bug fixes')).toBe('🐛Bug fixes');
  });

  it('does not strip more than one leading emoji + space pair', () => {
    expect(stripEmojiPrefix('🐛 🎉 Features')).toBe('🎉 Features');
  });
});
