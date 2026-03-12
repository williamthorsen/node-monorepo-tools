import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.js';

const rootElement = document.querySelector('#root');
if (!rootElement) {
  throw new Error('Root mount target not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
