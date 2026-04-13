// Stub — replace with real implementation
import type { ReadonlyURLSearchParams } from 'next/navigation';

export function consumePayloadFromUrl(
  source: string | ReadonlyURLSearchParams,
): Record<string, string> | null {
  // If passed a URL string, parse it; if passed searchParams, convert to string
  const urlStr = typeof source === 'string' ? source : `?${source.toString()}`;
  try {
    const params = new URLSearchParams(urlStr.split('?')[1] ?? '');
    const result: Record<string, string> = {};
    params.forEach((val, key) => { result[key] = val; });
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}