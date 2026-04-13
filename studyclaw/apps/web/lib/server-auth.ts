// Stub — replace with real implementation
import { cookies } from 'next/headers';

export async function requireAdminServerSession() {
  // const session = await getServerSession() — replace with real auth
  const session = { user: { id: 'stub', email: 'admin@stub', full_name: 'Admin' } };
  return session as { user: { id: string; email: string; full_name: string } };
}