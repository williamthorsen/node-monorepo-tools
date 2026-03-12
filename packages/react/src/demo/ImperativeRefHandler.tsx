import type { ReactElement, Ref } from 'react';
import { useRef } from 'react';
import { forwardRef as withForwardedRef, useImperativeHandle, useState } from 'react';

/**
 * This component demonstrates how to use `handleImperativeRef` to get a custom ref back from a child component.
 */
function ImperativeRefHandler({ content }: Props, forwardedRef?: ForwardedRef<CustomRefValue>): ReactElement {
  const [counter, setCounter] = useState(0);
  const callCounter = useRef(0);

  // If forwardedRef is a MutableObjectRef, set its `.current` prop to the value returned by the `init` callback;
  // if forwardedRef is a function, call it with the value returned by the `init` callback.
  useImperativeHandle(forwardedRef, () => ({
    increment(onCall: (callCount: number) => void): void {
      callCounter.current++;
      onCall(callCounter.current);
      setCounter(counter + 1);
    },
  }));
  return <div>{content}</div>;
}

type ForwardedRef<T> = Ref<T>;

export interface CustomRefValue {
  increment: (cb: (newValue: number) => void) => void;
}

interface Props {
  content: string;
}

export default withForwardedRef(ImperativeRefHandler);
