import Link from 'next/link';
import type { ReactElement } from 'react';

import { sampleUserData } from '@/app/users/sample-data.ts';

export default function UsersPage(): ReactElement {
  return (
    <div>
      <h1>Users List</h1>
      <ul>
        {sampleUserData.map((user) => (
          <li key={user.id}>
            <Link href={`/users/${user.id}`}>{user.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
