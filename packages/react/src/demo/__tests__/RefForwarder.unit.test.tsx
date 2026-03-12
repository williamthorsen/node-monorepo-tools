/* eslint unicorn/no-null: off */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RefForwarder from '../RefForwarder.js';

/**
 * This test suite demonstrates how React handles the `ref` argument forwarded by a component wrapped with `forwardRef`.
 * If the `ref` argument is a MutableRefObject (typically, created by `useRef`), React sets its `.current` prop to  the
 * DOM node to which the ref is assigned in the wrapped component.
 * If the `ref` argument is a function, React invokes the function with that DOM node.
 * (It is this dual behaviour that makes `forwardRef` somewhat tricky to understand.)
 *
 * @vitest-environment jsdom
 */

describe('RefForwarder', () => {
  afterEach(() => cleanup()); // reset the DOM between tests

  it('successfully renders', () => {
    const content = 'RefForwarder content';
    render(<RefForwarder content={content} />);
    const contentElement = screen.getByText('RefForwarder content');
    expect(contentElement).toBeInTheDocument();
  });

  it('if ref is a function, React calls it with the DOM node to which the ref is assigned in the wrapped component', () => {
    const content = 'Content';
    const ref = vi.fn();

    // `RefForwarder` assigns the `ref` callback to the `ref` attribute in the wrapped component.
    // React then calls the callback with the DOM node to which the `ref` is assigned.
    render(<RefForwarder content={content} ref={ref} />);

    const expectedTargetElement = screen.getByText(content);
    expect(ref).toHaveBeenCalledWith(expectedTargetElement);
  });

  it('if ref is a MutableRefObject, React sets its current prop to the DOM node to which the ref is assigned in the wrapped component', () => {
    const content = 'Content';
    const ref = { current: null }; // satisfies the `MutableRefObject` interface

    // `RefForwarder` assigns the `ref` callback to the `ref` attribute in the wrapped component.
    // React then sets the `.current` prop to the DOM node to which the `ref` is assigned.
    render(<RefForwarder content={content} ref={ref} />);

    const expectedTargetElement = screen.getByText(content);
    expect(ref.current).toBe(expectedTargetElement);
  });
});
