import { mount } from 'svelte';

import App from './App.svelte';

import './app.postcss';

function assertIsNonNullable<T>(value: T | undefined | null): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error('Expected value to be non-nullable');
  }
}

const target = document.querySelector('#app');
assertIsNonNullable(target);
const app = mount(App, {
  target,
});

export default app;
