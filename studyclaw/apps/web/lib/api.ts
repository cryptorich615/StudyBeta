import { readStoredSession } from './session';

const FALLBACK_API_BASE = 'http://localhost:4000';

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

  return fetch(resolveApiUrl(path), {
    ...init,
    headers,
  });
}
