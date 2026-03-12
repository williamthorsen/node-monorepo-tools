import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Fibonacci, FibonacciMemoWrapper, FibonacciWrapper, TEST_ID } from '../memoization.jsx';

/**
 * This test suite demonstrates how React's `useMemo` and `memo` work.
 * The tests are not intended as examples of how to test production code.
 */

const STARTING_FIB_INDEX = 0;

describe('Fibonacci component', () => {
  function setupFibonacci() {
    // Reference: https://testing-library.com/docs/example-input-event
    const onFib = vi.fn();
    const onRender = vi.fn();
    render(<Fibonacci onFib={onFib} onRender={onRender} startingFibIndex={STARTING_FIB_INDEX} />);
    const button: HTMLButtonElement = screen.getByText('Increment counter');
    const input: HTMLInputElement = screen.getByTestId(TEST_ID);
    return { button, input, onFib, onRender };
  }

  afterEach(() => cleanup()); // reset the DOM between tests

  it('when the counter changes, re-renders without running the fib function', async () => {
    const { button, onFib, onRender } = setupFibonacci();
    expect(onFib).toHaveBeenCalledTimes(1);
    expect(onFib).toHaveBeenCalledWith(STARTING_FIB_INDEX);
    expect(onRender).toHaveBeenCalledTimes(1);

    button.click();
    await waitFor(() => expect(onFib).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRender).toHaveBeenCalledTimes(2));
  });

  it('when the Fib index changes, re-renders and runs the fib function', async () => {
    const { input, onFib, onRender } = setupFibonacci();
    const fibIndex = 5;

    fireEvent.change(input, { target: { value: fibIndex } });

    await waitFor(() => expect(onFib).toHaveBeenCalledTimes(2));
    expect(onFib).toHaveBeenNthCalledWith(2, fibIndex);
    await waitFor(() => expect(onRender).toHaveBeenCalledTimes(2));
  });
});

describe('FibonacciWrapper component', () => {
  afterEach(() => cleanup());

  function setupFibonacciWrapper() {
    const onFib = vi.fn();
    const onRender = vi.fn();
    render(<FibonacciWrapper onFib={onFib} onRender={onRender} startingFibIndex={STARTING_FIB_INDEX} />);
    const wrapperButton: HTMLButtonElement = screen.getByText('Increment wrapper counter');
    const input: HTMLInputElement = screen.getByTestId(TEST_ID);
    return { input, onFib, onRender, wrapperButton };
  }

  it('when the wrapper counter changes, re-renders the child component without running the fib function', async () => {
    const { wrapperButton, onFib, onRender } = setupFibonacciWrapper();
    expect(onFib).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onFib).toHaveBeenCalledWith(STARTING_FIB_INDEX);

    wrapperButton.click();
    await waitFor(() => expect(onFib).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRender).toHaveBeenCalledTimes(2));
  });
});

describe('FibonacciMemoWrapper component', () => {
  afterEach(() => cleanup());

  function setupFibonacciMemoWrapper() {
    const onFib = vi.fn();
    const onRender = vi.fn();
    render(<FibonacciMemoWrapper onFib={onFib} onRender={onRender} startingFibIndex={STARTING_FIB_INDEX} />);
    const wrapperButton: HTMLButtonElement = screen.getByText('Increment wrapper counter');
    const input: HTMLInputElement = screen.getByTestId(TEST_ID);
    return { input, onFib, onRender, wrapperButton };
  }

  it('when the memoized wrapper changes, neither runs the fib function nor re-renders the child component', async () => {
    const { wrapperButton, onFib, onRender } = setupFibonacciMemoWrapper();
    expect(onFib).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onFib).toHaveBeenCalledWith(STARTING_FIB_INDEX);

    wrapperButton.click();
    await waitFor(() => expect(onFib).toHaveBeenCalledTimes(1));
    await expect(waitFor(() => expect(onRender).toHaveBeenCalledTimes(2), { timeout: 200 })).rejects.toThrow();
  });
});
