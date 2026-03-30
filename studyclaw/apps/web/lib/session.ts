export type StoredUsageProfile = {
  tier: 'tier_1' | 'tier_2' | 'tier_3' | null;
  billingMode: 'managed' | 'byok' | 'local' | 'admin' | 'unknown';
  usesManagedCredits: boolean;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  windowLimit?: number | null;
  remainingInWindow?: number | null;
  providerSelection?: string | null;
  modelSelection?: string | null;
};

export type StoredSession = {
  user: {
    id: string;
    email: string;
    full_name?: string;
    role?: string;
    agent_type?: string | null;
  };
  accessToken: string;
  onboardingComplete?: boolean;
  usageProfile?: StoredUsageProfile | null;
};

const SESSION_KEY = 'studyclaw-user';
export const SESSION_COOKIE_KEY = 'studyclaw_access_token';
export const SESSION_ROLE_COOKIE_KEY = 'studyclaw_role';

function persistSessionCookies(session: StoredSession | null) {
  if (typeof document === 'undefined') {
    return;
  }

  if (!session?.accessToken) {
    document.cookie = `${SESSION_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    document.cookie = `${SESSION_ROLE_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }

  const maxAge = 60 * 60 * 24 * 7;
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_COOKIE_KEY}=${encodeURIComponent(session.accessToken)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  document.cookie = `${SESSION_ROLE_COOKIE_KEY}=${encodeURIComponent(session.user.role ?? 'student')}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSession;
    persistSessionCookies(parsed);
    return parsed;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    persistSessionCookies(null);
    return null;
  }
}

export function writeStoredSession(session: StoredSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  persistSessionCookies(session);
}

export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_KEY);
  persistSessionCookies(null);
}

export function isOnboardingComplete(session: StoredSession | null) {
  if (!session?.user?.id) {
    return false;
  }

  if (session.user.role === 'admin') {
    return true;
  }

  return Boolean(session.onboardingComplete || (session.user.agent_type && session.user.agent_type !== 'custom'));
}
