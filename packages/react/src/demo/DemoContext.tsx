import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext } from 'react';

export const DEFAULT_HEADING = 'Default heading';
export const PROVIDER_HEADING = 'Provider heading';

export const ID_ATTRIBUTE = {
  'data-testid': 'heading',
};

export const DemoContext = createContext<DemoContextValue>({ heading: 'Default heading' });

/**
 * Makes the context set in this component available to all descendants of this component.
 * If a child is wrapped by multiple Providers, it will use the context provided by the closest Provider.
 * If a component is not wrapped by a Provider, it will use the default value of the context.
 */
export function DemoContextProvider({ children, heading }: Props): ReactElement {
  return <DemoContext.Provider value={{ heading: heading ?? PROVIDER_HEADING }}>{children}</DemoContext.Provider>;
}

/**
 * Demonstrates that a component not wrapped by the context Provider can access the default value of the context.
 */
export function DemoContextConsumer(): ReactElement {
  const demoContextValue = useContext(DemoContext);

  return (
    <div>
      <h1 {...ID_ATTRIBUTE}>{demoContextValue.heading}</h1>
    </div>
  );
}
interface DemoContextValue {
  heading: string;
}

interface Props {
  children?: ReactNode;
  heading?: string;
}
