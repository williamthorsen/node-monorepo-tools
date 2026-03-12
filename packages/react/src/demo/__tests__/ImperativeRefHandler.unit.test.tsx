/* eslint unicorn/no-null: off */
import { cleanup, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

import ImperativeRefHandler, { type CustomRefValue } from '../ImperativeRefHandler.js';

/**
 * This test suite demonstrates how React's `useImperativeHandle` works with MutableRefObject and callback refs.
 * `useImperativeHandle` allows a component
 *  - to set the value of the forwarded ref to an arbitrary value, if the ref is a MutableRefObject, or
 *  - to invoke the forwarded ref with the arbitrary value, if the ref is a function.
 *
 * See the `RefForwarder` component for a simpler example of that always uses a DOM node instead of an arbitrary value.
 *
 * The following control comment isn't needed, because `config.test.environment = 'jsdom'` in the Vitest config, but
 * it is included here as an example of how to set the environment for a particular test suite.
 * See https://vitest.dev/guide/environment.html.
 *
 * @vitest-environment jsdom
 */

describe('ImperativeRefHandler component', () => {
  afterEach(() => cleanup()); // reset the DOM between tests

  it('successfully renders', () => {
    const content = 'Content';
    render(<ImperativeRefHandler content={content} />);
    const contentElement = screen.getByText(content);
    expect(contentElement).toBeInTheDocument();
  });

  test('if ref is a function, React calls it with the value returned by the callback passed to useImperativeHandle', () => {
    let refValue: CustomRefValue | null = null;
    const ref = vi.fn((value: CustomRefValue | null) => {
      refValue = value;
    });

    render(<ImperativeRefHandler content="Content" ref={ref} />);

    expect(ref).toHaveBeenCalledWith({ increment: expect.any(Function) });

    const onCallSpy = vi.fn(); // receives a count of how many times `increment` has been called
    if (!isNull(refValue)) {
      const customRefValue: CustomRefValue = refValue;
      customRefValue.increment(onCallSpy);
      expect(onCallSpy).toHaveBeenNthCalledWith(1, 1);

      customRefValue.increment(onCallSpy);
      expect(onCallSpy).toHaveBeenNthCalledWith(2, 2);
    }
  });

  test('if ref is a MutableRefObject, React sets its .current prop to the value returned by the callback passed to useImperativeHandle', () => {
    const content = 'Content';
    const ref: RefObject<null | CustomRefValue> = { current: null };

    render(<ImperativeRefHandler content={content} ref={ref} />);

    const onCallSpy = vi.fn(); // receives a count of how many times `increment` has been called
    const { current } = ref;
    current?.increment(onCallSpy);
    expect(onCallSpy).toHaveBeenNthCalledWith(1, 1);

    current?.increment(onCallSpy);
    expect(onCallSpy).toHaveBeenNthCalledWith(2, 2);
  });
});

// Added to document a current limitation of the `no-unnecessary-condition` rule:
// > This rule has a known edge case of triggering on conditions that were modified within function calls (as side effects).
// It is due to limitations of TypeScript's type narrowing.
// See #9998 for details.
// > We recommend using a type assertion in those cases.
// @link https://typescript-eslint.io/rules/no-unnecessary-condition
function isNull(value: unknown): value is null {
  return value === null;
}
