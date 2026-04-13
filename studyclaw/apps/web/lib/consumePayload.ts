import type { ReadonlyURLSearchParams } from 'next/navigation';

import { writeStoredSession, type StoredSession } from './session';

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return window.atob(`${normalized}${padding}`);
}

function toSearchParams(source: URLSearchParams | ReadonlyURLSearchParams | string) {
  if (typeof source === 'string') {
    return new URLSearchParams(source.startsWith('?') ? source.slice(1) : source);
  }

  return new URLSearchParams(source.toString());
}

export function consumePayloadFromUrl(
  source: URLSearchParams | ReadonlyURLSearchParams | string,
): StoredSession | null {
  if (typeof window === 'undefined') return null;

  const searchParams = toSearchParams(source);
  const payload = searchParams.get('payload');
  if (!payload) return null;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as StoredSession;
    if (!decoded.accessToken || !decoded.user?.id) {
      return null;
    }

    writeStoredSession(decoded);

    const url = new URL(window.location.href);
    url.searchParams.delete('payload');
    url.searchParams.delete('connected');
    window.history.replaceState({}, '', url.toString());

    return decoded;
  } catch {
    return null;
  }
}

export function hasPayloadInUrl(source: URLSearchParams | ReadonlyURLSearchParams | string): boolean {
  return toSearchParams(source).has('payload');
}
