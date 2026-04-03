import { clearStoredSession, readStoredSession } from './session';

const FALLBACK_API_BASE = 'http://localhost:4000';
export const ACCOUNT_REFRESH_EVENT = 'studyclaw:account-refresh';

function normalizeApiPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function getApiBaseUrl() {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || FALLBACK_API_BASE;
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

export function getApiErrorMessage(payload: any, fallback: string) {
  return typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message
    : fallback;
}

export async function beginGoogleConnect(returnTo: string) {
  const params = new URLSearchParams({ returnTo });
  if (typeof window !== 'undefined') {
    params.set('frontendOrigin', window.location.origin);
  }

  const response = await apiFetch(`/api/google/connect-url?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.url) {
    throw new Error(payload?.message || 'Failed to start Google connection');
  }

  window.location.assign(payload.url);
}
