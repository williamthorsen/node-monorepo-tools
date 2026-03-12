import Head from 'next/head';
import type { PropsWithChildren, ReactElement } from 'react';

import { Header } from '@/components/Header.tsx';

function Layout({ children, title = 'This is the default title' }: Readonly<Props>): ReactElement {
  return (
    <div className="container mx-auto px-4">
      <Head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
        <link rel="icon" type="image/png" href="/favicon.png" />
      </Head>
      <Header />
      <main className="py-4">{children}</main>
      <footer className="py-4">
        <hr />
        <span>Footer</span>
      </footer>
    </div>
  );
}

interface Props extends PropsWithChildren {
  title?: string;
}

export default Layout;
