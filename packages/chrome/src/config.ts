const extensionSlug = 'template-extension';

export const EXTENSION_CONSTANTS = {
  extensionName: 'Template Chrome Dev Tools Extension',
  extensionSlug,
  newTaskEventName: `${extensionSlug}-event`,
  panelInitMessageType: `${extensionSlug}-panel-init`,
  /** Name of the port on which the panel app connects to the background service worker. */
  panelPortName: `${extensionSlug}-panel-port`,
  panelTitle: 'MY PANEL',
  targetOrigin: '*', // or 'chrome-extension://${extensionId}` if known
};
