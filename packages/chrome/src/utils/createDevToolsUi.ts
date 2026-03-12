import { createShowMessage } from '~src/utils/showMessage.ts';

const showDevToolsMessage = createShowMessage('devtools.ts');

interface CreateDevToolsUiProps {
  dataAttribute: string;
  notFoundMessage: string;
  createUi: () => void;
}

/**
 * Creates the DevTools UI element if the required data attribute is found.
 */
export function createDevToolsUi({ dataAttribute, notFoundMessage, createUi }: CreateDevToolsUiProps): void {
  chrome.devtools.inspectedWindow.eval<boolean>(
    `document.querySelector('[${dataAttribute}]') !== null`,
    (result, exceptionInfo?: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => {
      if (exceptionInfo || !result) {
        showDevToolsMessage({ message: notFoundMessage });
        return;
      }
      createUi();
    },
  );
}
