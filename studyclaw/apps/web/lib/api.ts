import { clearStoredSession, readStoredSession } from './session';

const FALLBACK_API_BASE = 'http://localhost:4000';
export const ACCOUNT_REFRESH_EVENT = 'studyclaw:account-refresh';

function normalizeApiPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function preferSecureApiBase(url: string) {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      if (parsed.port === '4000' || parsed.port === '80') {
        parsed.port = '';
      }
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    return url;
  }

  return url;
}

export function getApiBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (envUrl) return preferSecureApiBase(envUrl);

  const legacyUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (legacyUrl) return preferSecureApiBase(legacyUrl);

  if (typeof window !== 'undefined') {
    return preferSecureApiBase(window.location.origin);
  }

  return FALLBACK_API_BASE;
}

export function resolveApiUrl(path: string) {
  const normalizedPath = normalizeApiPath(path);
  return new URL(normalizedPath, `${getApiBaseUrl()}/`).toString();
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const session = readStoredSession();
  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.user?.id) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearStoredSession();
  }

  if (typeof window !== 'undefined' && String(init.method ?? 'GET').toUpperCase() !== 'GET') {
    window.dispatchEvent(new Event(ACCOUNT_REFRESH_EVENT));
  }

  return response;
}

export async function readApiPayload(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

export async function beginGoogleConnect(returnTo: string) {
  const params = new URLSearchParams({ returnTo });
  if (typeof window !== 'undefined') {
    params.set('frontendOrigin', window.location.origin);
  }

  const response = await apiFetch(`/api/google/connect-url?${params.toString()}`);
  const payload = await response.json().catch(() => ({} as { url?: string; message?: string }));

  if (!response.ok || !payload?.url) {
    throw new Error(payload?.message || 'Failed to start Google connection');
  }

  window.location.assign(payload.url);
}

export function getApiErrorMessage(response: Response, fallback?: string): string;
export function getApiErrorMessage(payload: unknown, fallback?: string): string;
export function getApiErrorMessage(arg0: Response | unknown, fallback?: string): string {
  if (arg0 instanceof Response) {
    return fallback ?? `API error ${arg0.status}`;
  }
  if (arg0 && typeof arg0 === 'object') {
    const payload = arg0 as Record<string, unknown>;
    const message = typeof payload.message === 'string' ? payload.message : payload.error;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback ?? 'Unknown error';
}
