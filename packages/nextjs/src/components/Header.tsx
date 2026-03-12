import Link from 'next/link';
import type { ReactElement } from 'react';

export function Header(): ReactElement {
  return (
    <header className="flex justify-between items-center py-4">
      <nav className="flex justify-start gap-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800">
          Home
        </Link>
        <Link href="/about" className="text-blue-600 hover:text-blue-800">
          About
        </Link>
        <Link href="/users" className="text-blue-600 hover:text-blue-800">
          Users List
        </Link>
      </nav>
    </header>
  );
}
