import { describe, expect, it } from 'vitest';

import { isEnvSwitchOn, readEnvSwitch, readEnvSwitches } from '../env-switch.ts';

const NAME = 'NMR_EXAMPLE_SWITCH';

describe(readEnvSwitch, () => {
  it.each([
    { rawValue: undefined, scenario: 'no value at all' },
    { rawValue: '', scenario: 'a value left empty' },
    { rawValue: '0', scenario: '0' },
  ])('given $scenario, reads the switch as off', ({ rawValue }) => {
    const env = rawValue === undefined ? {} : { [NAME]: rawValue };

    expect(readEnvSwitch(env, NAME)).toStrictEqual({ ok: true, isOn: false });
  });

  it('given 1, reads the switch as on', () => {
    expect(readEnvSwitch({ [NAME]: '1' }, NAME)).toStrictEqual({ ok: true, isOn: true });
  });

  it.each([
    { rawValue: 'true', scenario: 'a word for on' },
    { rawValue: ' 1', scenario: 'an accepted value padded with whitespace' },
    { rawValue: 'yes', scenario: 'another word for on' },
  ])('given $scenario, rejects the value rather than reading it as off', ({ rawValue }) => {
    expect(readEnvSwitch({ [NAME]: rawValue }, NAME).ok).toBe(false);
  });

  it('names the variable, its value, and the accepted values when it rejects', () => {
    expect(readEnvSwitch({ [NAME]: 'true' }, NAME)).toStrictEqual({
      ok: false,
      error: 'NMR_EXAMPLE_SWITCH is `true`, which is not one of: 0, 1 (unset or empty is off)',
    });
  });
});

describe(readEnvSwitches, () => {
  it('returns the message for the first switch that it does not accept', () => {
    const env = { A: '1', B: 'on', C: 'off' };

    expect(readEnvSwitches(env, ['A', 'B', 'C'])).toBe('B is `on`, which is not one of: 0, 1 (unset or empty is off)');
  });

  it('returns nothing when every switch is accepted', () => {
    expect(readEnvSwitches({ A: '1', B: '0' }, ['A', 'B', 'C'])).toBeUndefined();
  });
});

describe(isEnvSwitchOn, () => {
  it.each([
    { rawValue: '1', expected: true },
    { rawValue: '0', expected: false },
    { rawValue: undefined, expected: false },
  ])('given $rawValue, reports $expected', ({ rawValue, expected }) => {
    const env = rawValue === undefined ? {} : { [NAME]: rawValue };

    expect(isEnvSwitchOn(env, NAME)).toBe(expected);
  });
});
