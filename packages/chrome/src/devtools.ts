type ExtensionPanel = chrome.devtools.panels.ExtensionPanel;
type ExtensionSidebarPane = chrome.devtools.panels.ExtensionSidebarPane;

const PANEL_PROPERTIES = {
  title: 'MY PANEL',
  iconPath: '',
  pagePath: '/panel/index.html',
};

function configurePanel(_extensionPanel: ExtensionPanel): void {
  console.info('The panel is accessible at chrome://extensions/?id=' + chrome.runtime.id);
}

chrome.devtools.panels.create(
  PANEL_PROPERTIES.title,
  PANEL_PROPERTIES.iconPath,
  PANEL_PROPERTIES.pagePath,
  configurePanel,
);

const SIDEBAR_PROPERTIES = {
  title: 'MY SIDEBAR',
  iconPath: '',
  sidebarPath: '/devtools-sidebar.html',
};

function configureSidebarPane(sidebarPane: ExtensionSidebarPane): void {
  sidebarPane.setPage('/devtools-sidebar.html'); // Path to the HTML content
  sidebarPane.setHeight('8ex'); // Height of the sidebar in the DevTools window
  console.info('The sidebar is accessible at chrome://extensions/?id=' + chrome.runtime.id);
}

chrome.devtools.panels.elements.createSidebarPane(SIDEBAR_PROPERTIES.title, configureSidebarPane);
