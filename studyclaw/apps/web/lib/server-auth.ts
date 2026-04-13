import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_KEY } from './session';

type AdminSession = {
  user: {
    id: string;
    email: string;
    full_name?: string;
    role?: string;
  };
  onboardingComplete?: boolean;
  usageProfile?: Record<string, unknown> | null;
};

function getServerApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:4000';
}

export async function requireAdminServerSession(): Promise<AdminSession> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(SESSION_COOKIE_KEY)?.value;
  if (!accessToken) {
    redirect('/auth?mode=login');
  }

  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  }).catch(() => null);

  if (!response || !response.ok) {
    redirect('/auth?mode=login');
  }

  const data = (await response.json().catch(() => null)) as AdminSession | null;
  if (!data?.user?.id) {
    redirect('/auth?mode=login');
  }

  if (data.user.role !== 'admin') {
    redirect('/dashboard');
  }

  return data;
}
