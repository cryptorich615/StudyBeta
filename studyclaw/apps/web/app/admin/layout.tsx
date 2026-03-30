import AdminShell from '../components/admin-shell';
import { requireAdminServerSession } from '../../lib/server-auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminServerSession();

  return (
    <AdminShell
      adminUser={{
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.full_name,
      }}
    >
      {children}
    </AdminShell>
  );
}
