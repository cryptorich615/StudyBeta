// Stub — replace with real implementation
import type { ReadonlyURLSearchParams } from 'next/navigation';

type SessionPayload = { user?: { id?: string } } | null;

export function consumePayloadFromUrl(
  source: string | ReadonlyURLSearchParams,
): SessionPayload {
  // If passed a URL string, parse it; if passed searchParams, convert to string
  const urlStr = typeof source === 'string' ? source : `?${source.toString()}`;
  try {
    const params = new URLSearchParams(urlStr.split('?')[1] ?? '');
    const raw = params.get('session');
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw)) as SessionPayload;
  } catch {
    return null;
  }
}