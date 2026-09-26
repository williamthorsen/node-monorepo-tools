import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../apply-overrides.ts';

describe(applyOverrides, () => {
  it('leaves the record unchanged when no override is set', () => {
    const record = { breaking: true, scope: 'agents', title: 'Add the parser', type: 'feat' };

    expect(applyOverrides(record, {})).toStrictEqual(record);
  });

  it('replaces each overridden field on its own, keeping the rest of the record', () => {
    const record = { prNumber: '470', scope: 'agents', ticketRef: '#466', title: 'Add the parser', type: 'feat' };

    expect(applyOverrides(record, { scope: 'kb' })).toStrictEqual({ ...record, scope: 'kb' });
  });

  it('clears the scope for a scope of *', () => {
    expect(applyOverrides({ scope: 'agents', type: 'feat' }, { scope: '*' })).toStrictEqual({ type: 'feat' });
  });

  it('keeps the marker when only the type is overridden', () => {
    expect(applyOverrides({ breaking: true, type: 'feat' }, { type: 'sec' })).toStrictEqual({
      breaking: true,
      type: 'sec',
    });
  });

  describe('when the overrides can only add the marker', () => {
    it('adds the marker to a record that has none', () => {
      expect(applyOverrides({ type: 'feat' }, { breaking: true })).toStrictEqual({ breaking: true, type: 'feat' });
    });

    it('keeps a marker that the record has', () => {
      expect(applyOverrides({ breaking: true, type: 'feat' }, { scope: 'kb' }).breaking).toBe(true);
    });
  });

  describe('when the overrides set the marker in either direction', () => {
    it('removes a marker that the record has', () => {
      expect(applyOverrides({ breaking: true, type: 'feat' }, { breaking: false })).toStrictEqual({ type: 'feat' });
    });

    it('leaves a record without the marker unmarked', () => {
      expect(applyOverrides({ type: 'feat' }, { breaking: false })).toStrictEqual({ type: 'feat' });
    });
  });
});
