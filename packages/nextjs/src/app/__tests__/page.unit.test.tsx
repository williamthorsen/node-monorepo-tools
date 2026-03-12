import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '@/app/page.tsx';

describe('placeholder component test', () => {
  it('renders the "Hello Next.js" heading', () => {
    render(<HomePage />);
    const headingElement = screen.getByText(/Hello Next.js/i);
    expect(headingElement).toBeInTheDocument();
  });
});
