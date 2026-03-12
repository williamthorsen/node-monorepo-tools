/* eslint no-console: off */
import { EXTENSION_CONSTANTS } from '~src/config.ts';
import { createTimestamp } from '~src/utils/createTimestamp.ts';

export interface ShowMessageProps {
  data?: unknown;
  logLevel?: 'info' | 'warn' | 'error';
  message: string | string[];
  scriptName: string;
}

export function showMessage({ data, logLevel = 'info', message, scriptName }: ShowMessageProps): void {
  const messages = Array.isArray(message) ? message : [message];
  const messagePrefix = [createTimestamp('time'), EXTENSION_CONSTANTS.extensionName, `(${scriptName})`].join(' ');
  const formattedMessage = [messagePrefix, ...messages].filter(Boolean).join(' | ');
  if (data) {
    console.group(formattedMessage);
    console[logLevel](data);
    console.groupEnd();
  } else {
    console[logLevel](formattedMessage);
  }
}

export function createShowMessage(scriptName: string): (props: Omit<ShowMessageProps, 'scriptName'>) => void {
  return (props) => {
    showMessage({ ...props, scriptName });
  };
}
