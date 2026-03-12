import type { ReactElement } from 'react';

import { sampleUserData } from '@/app/users/sample-data.ts';

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function UserPage({ params }: Props): Promise<ReactElement> {
  const { id } = await params;

  const user = sampleUserData.find((u) => u.id === id);

  // If no user is found, return a "User Not Found" message
  if (!user) {
    return (
      <div>
        <h1>User Not Found</h1>
        <p>No user exists with ID {id}.</p>
      </div>
    );
  }

  // Render a specific user's data
  return (
    <div>
      <h1>{user.name}</h1>
      <p>This is the profile page for user ID: {id}.</p>
    </div>
  );
}
