import { writeStoredSession, type StoredSession } from './session';

/**
 * Reads ?payload= from URL searchParams, decodes it, stores the session,
 * removes the param from URL, and returns the session data.
 * 
 * Call this on pages that may receive auth via URL payload (dashboard, onboarding, calendar).
 */
export function consumePayloadFromUrl(searchParams: URLSearchParams): StoredSession | null {
  if (typeof window === 'undefined') return null;

  const payload = searchParams.get('payload');
  if (!payload) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StoredSession;
    
    if (decoded.accessToken && decoded.user?.id) {
      writeStoredSession(decoded);
      
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('payload');
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url.toString());
      
      return decoded;
    }
  } catch (error) {
    console.error('Failed to consume payload from URL:', error);
  }

  return null;
}

/**
 * Check if URL has pending payload without consuming it
 */
export function hasPayloadInUrl(searchParams: URLSearchParams): boolean {
  return searchParams.has('payload');
}
