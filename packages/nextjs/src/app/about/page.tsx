'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';

import Layout from '@/components/Layout.tsx';

function AboutPage(): ReactElement {
  return (
    <Layout title="About | Next.js App">
      <h1>About</h1>
      <p>This is the about page</p>
      <p>
        <Link href="/">Go home</Link>
      </p>
    </Layout>
  );
}

export default AboutPage;
