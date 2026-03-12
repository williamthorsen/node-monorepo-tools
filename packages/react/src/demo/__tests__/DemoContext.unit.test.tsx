import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HEADING,
  DemoContext,
  DemoContextConsumer,
  DemoContextProvider,
  ID_ATTRIBUTE,
  PROVIDER_HEADING,
} from '../DemoContext.jsx';

const TEST_ID = ID_ATTRIBUTE['data-testid'];

describe('DemoContextUser component', () => {
  afterEach(() => cleanup()); // reset the DOM between tests

  it('if not wrapped by a Provider, gets the default context', () => {
    const expectedHeading = DEFAULT_HEADING;

    render(<DemoContextConsumer />);

    const headingElement = screen.getByTestId(TEST_ID);
    expect(headingElement).toHaveTextContent(expectedHeading);
  });

  it('if wrapped by Context.Provider, gets the context provided by the Provider', () => {
    const expectedHeading = PROVIDER_HEADING;

    render(
      <DemoContext.Provider value={{ heading: expectedHeading }}>
        <DemoContextConsumer />
      </DemoContext.Provider>,
    );

    const headingElement = screen.getByTestId(TEST_ID);
    expect(headingElement).toHaveTextContent(expectedHeading);
  });

  it('if wrapped by a Provider component, gets the context provided by the wrapper component', () => {
    const expectedHeading = PROVIDER_HEADING;

    render(
      <DemoContextProvider>
        <DemoContextConsumer />
      </DemoContextProvider>,
    );

    const headingElement = screen.getByTestId(TEST_ID);
    expect(headingElement).toHaveTextContent(expectedHeading);
  });

  it('if Provider passes a custom value into the context, gets the custom value from the context', () => {
    const customHeading = 'Custom heading';
    const expectedHeading = customHeading;

    render(
      <DemoContextProvider heading={customHeading}>
        <DemoContextConsumer />
      </DemoContextProvider>,
    );

    const headingElement = screen.getByTestId(TEST_ID);
    expect(headingElement).toHaveTextContent(expectedHeading);
  });
});
