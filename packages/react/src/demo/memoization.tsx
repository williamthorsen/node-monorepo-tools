/* eslint unicorn/no-null: off */
import type { ChangeEvent, ReactElement } from 'react';
import { memo, useMemo, useState } from 'react';

// TODO: Add an example of `useCallback`.

export const TEST_ID = 'fib_n';

export function Fibonacci({ onFib, onRender, startingFibIndex = 0 }: Readonly<Props>): ReactElement {
  const [counter, setCounter] = useState<Integer>(0);
  const [fibIndex, setFibIndex] = useState<Integer>(startingFibIndex);
  const fibNum = useMemo(() => {
    onFib?.(fibIndex);
    return fib(fibIndex);
  }, [fibIndex]);

  function incrementCounter(): void {
    setCounter(counter + 1);
  }

  /** Sets the index of the Fibonacci number to calculate. */
  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    setFibIndex(Number.parseInt(event.target.value));
  }

  onRender?.();

  return (
    <div>
      <h1 className="h1">Fibonacci</h1>
      <p>
        Fib {fibIndex} is {fibNum}
      </p>
      <p>Counter: {counter}</p>
      <button onClick={incrementCounter}>Increment counter</button>
      <input data-testid={TEST_ID} type="number" className="border-2" onChange={onInputChange} />
    </div>
  );
}

const FibonacciMemo = memo(Fibonacci);

/** A wrapper component that uses the Fibonacci component. */
export function FibonacciWrapper(props: Props): ReactElement {
  const [counter, setCounter] = useState<Integer>(0);
  function incrementCounter(): void {
    setCounter(counter + 1);
  }

  return (
    <>
      <Fibonacci {...props} />
      <p>Wrapper counter: {counter}</p>
      <button onClick={incrementCounter}>Increment wrapper counter</button>
    </>
  );
}

/** A wrapper component that memoizes the Fibonacci component. */
export function FibonacciMemoWrapper(props: Props): ReactElement {
  const [counter, setCounter] = useState<Integer>(0);
  function incrementCounter(): void {
    setCounter(counter + 1);
  }

  return (
    <>
      <FibonacciMemo {...props} />
      <p>Wrapper counter: {counter}</p>
      <button onClick={incrementCounter}>Increment wrapper counter</button>
    </>
  );
}

/**
 * Returns the nth Fibonacci number.
 * @param n
 */
function fib(n: Integer): Integer {
  if (n === 0) {
    return 0;
  }
  if (n === 1 || n === 2) {
    return 1;
  }
  return fib(n - 1) + fib(n - 2);
}

type Integer = number;

interface Props {
  onFib?: (n: Integer) => void; // callback to invoke when a Fibonacci number is calculated
  onRender?: () => void; // callback to invoke when the component renders
  startingFibIndex?: Integer; // the index of the the Fibonacci number to calculate on first render
}
