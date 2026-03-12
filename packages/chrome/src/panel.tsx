import React from 'react';
import ReactDOM from 'react-dom/client';

import { assert } from './utils/assert.js';

const containerStyle = {
  backgroundColor: '#f5f5f5',
  border: '1px dashed red',
  BoxSizing: 'border-box',
  fontFamily: 'Arial, sans-serif',
  padding: '16px',
};

const headingStyle = {
  color: '#333',
};

const App: React.FC = () => (
  <div style={containerStyle}>
    <h1 style={headingStyle}>DevTools panel starter</h1>
    <p>This is a React app rendered as a Chrome DevTools panel.</p>
  </div>
);

const rootTarget = document.querySelector('#root');
assert(rootTarget instanceof HTMLElement, 'Root mount target not found');

const root = ReactDOM.createRoot(rootTarget);
root.render(<App />);
