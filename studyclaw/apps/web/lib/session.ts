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
};

const SESSION_KEY = 'studyclaw-user';

export function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function writeStoredSession(session: StoredSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_KEY);
}

export function isOnboardingComplete(session: StoredSession | null) {
  if (!session?.user?.id) {
    return false;
  }

  return Boolean(session.onboardingComplete || session.user.agent_type);
}
