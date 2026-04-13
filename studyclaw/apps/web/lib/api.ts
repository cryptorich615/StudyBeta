import { readStoredSession } from './session';

const FALLBACK_API_BASE = 'http://localhost:4000';

function normalizeApiPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function getApiBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (envUrl) return envUrl;

  const legacyUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (legacyUrl) return legacyUrl;

  if (typeof window !== 'undefined') {
    return window.location.origin;
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

  return fetch(resolveApiUrl(path), {
    ...init,
    headers,
  });
}

// Stub exports — replace with real implementations

export function readApiPayload(_data: unknown): Record<string, unknown> | null {
  return null;
}

export function beginGoogleConnect(): string | null {
  return null;
}

// Fixed stub with 2-arg overload
}

// Overload: accepts Response OR already-parsed payload record
export function getApiErrorMessage(response: Response, fallback?: string): string;
export function getApiErrorMessage(payload: Record<string, unknown>, fallback?: string): string;
export function getApiErrorMessage(arg0: Response | Record<string, unknown>, fallback?: string): string {
  if (arg0 instanceof Response) {
    return fallback ?? `API error ${arg0.status}`;
  }
  const msg = (arg0 as Record<string, unknown>)?.error as string | undefined;
  return fallback ?? msg ?? 'Unknown error';
}
