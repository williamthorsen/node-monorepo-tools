import { describe, expect, it } from 'vitest';

import { injectSection } from '../injectSection.ts';

describe(injectSection, () => {
  it('replaces content between existing markers', () => {
    const content = [
      '<!-- section:release-notes -->',
      'old content',
      '<!-- /section:release-notes -->',
      '',
      '# README',
    ].join('\n');

    const result = injectSection(content, 'release-notes', 'new content');
    expect(result).toBe(
      ['<!-- section:release-notes -->', 'new content', '<!-- /section:release-notes -->', '', '# README'].join('\n'),
    );
  });

  it('prepends section with markers when none exist', () => {
    const content = '# README\n\nSome text.';
    const result = injectSection(content, 'release-notes', 'injected');
    expect(result).toBe(
      [
        '<!-- section:release-notes -->',
        'injected',
        '<!-- /section:release-notes -->',
        '',
        '# README',
        '',
        'Some text.',
      ].join('\n'),
    );
  });

  it('inserts into empty content', () => {
    const result = injectSection('', 'release-notes', 'injected');
    expect(result).toBe(
      ['<!-- section:release-notes -->', 'injected', '<!-- /section:release-notes -->', ''].join('\n'),
    );
  });

  it('handles multiple sections with different keys independently', () => {
    let content = '# README';
    content = injectSection(content, 'notes', 'Notes content');
    content = injectSection(content, 'changelog', 'Changelog content');

    expect(content).toContain('<!-- section:notes -->');
    expect(content).toContain('Notes content');
    expect(content).toContain('<!-- section:changelog -->');
    expect(content).toContain('Changelog content');
    expect(content).toContain('# README');
  });

  it('replaces only the targeted section when multiple sections exist', () => {
    const content = [
      '<!-- section:a -->',
      'old A',
      '<!-- /section:a -->',
      '',
      '<!-- section:b -->',
      'old B',
      '<!-- /section:b -->',
    ].join('\n');

    const result = injectSection(content, 'a', 'new A');
    expect(result).toContain('new A');
    expect(result).toContain('old B');
    expect(result).not.toContain('old A');
  });

  it('handles empty injection content', () => {
    const content = ['<!-- section:release-notes -->', 'old content', '<!-- /section:release-notes -->'].join('\n');

    const result = injectSection(content, 'release-notes', '');
    expect(result).toBe(['<!-- section:release-notes -->', '', '<!-- /section:release-notes -->'].join('\n'));
  });
});
