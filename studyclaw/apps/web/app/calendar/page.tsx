'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import { Calendar as CalendarIcon, RefreshCw, ExternalLink, MapPin, Clock, CheckCircle } from 'lucide-react';

type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  htmlLink: string | null;
};

function formatEventDateTime(dateTime: string | null) {
  if (!dateTime) return 'All day';
  const date = new Date(dateTime);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatEventTime(dateTime: string | null) {
  if (!dateTime) return '';
  const date = new Date(dateTime);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </div>
      ))}
    </div>
  );
}

function CalendarPageContent() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasSession = !!readStoredSession()?.user?.id;

  useEffect(() => {
    // Consume payload from URL if present (e.g., from OAuth redirect)
    consumePayloadFromUrl(searchParams);
    
    if (searchParams.get('connected') === 'true') {
      setShowSuccess(true);
      setConnected(true);
      setTimeout(() => setShowSuccess(false), 5000);
    }
  }, [searchParams]);

  async function loadStatus() {
    if (!hasSession) return;
    try {
      const res = await apiFetch('/api/google');
      const data = await res.json();
      setConnected(data.connected);
    } catch { setConnected(false); }
  }

  async function loadEvents() {
    if (!hasSession) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/google/calendar?days=14');
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 400 && (data.error === 'not_connected' || data.connected === false)) {
          setConnected(false);
          setLoading(false);
          return;
        }
        throw new Error(data.message || 'Failed to fetch');
      }
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : []);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  function handleConnect() {
    window.location.href = '/api/auth/google';
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }

  useEffect(() => {
    if (hasSession) {
      loadStatus();
    }
  }, [hasSession]);

  useEffect(() => {
    if (connected === true) {
      loadEvents();
    } else if (connected === false) {
      setLoading(false);
    }
  }, [connected]);

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Calendar</p>
        <h1 className="hero-title">Connect Google Calendar</h1>
        <p className="hero-description">Sign in to view and sync your calendar events.</p>
      </section>
    );
  }

  return (
    <>
      {showSuccess && (
        <div className="p-4 rounded-xl bg-success/10 border border-success/30 text-success text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          Google account connected successfully!
        </div>
      )}

      <section className="hero-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="insight-chip">Calendar</p>
            <h1 className="hero-title">Upcoming Events</h1>
          </div>
          {connected && (
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="ghost-button p-2"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <section className="secondary-card">
          <p className="eyebrow">Loading events...</p>
          <LoadingSkeleton />
        </section>
      ) : !connected ? (
        <section className="secondary-card">
          <div className="text-center py-12">
            <CalendarIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="muted-copy mb-4">Connect your Google account to see upcoming events</p>
            <button onClick={handleConnect} className="primary-link-button">
              Connect Google Account
            </button>
          </div>
        </section>
      ) : events.length === 0 ? (
        <section className="secondary-card">
          <p className="muted-copy text-center py-8">No upcoming events in the next 14 days</p>
        </section>
      ) : (
        <section className="stack-list">
          {events.map((event) => (
            <article key={event.id} className="stack-item">
              <div className="flex-1">
                <div className="flex items-start gap-3">
                  <CalendarIcon className="w-5 h-5 mt-0.5 text-primary flex-shrink-0" />
                  <div>
                    <strong>{event.title || 'Untitled Event'}</strong>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatEventTime(event.startsAt) || 'All day'}
                        {event.startsAt && event.endsAt && (
                          <> – {formatEventTime(event.endsAt)}</>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="ghost-button p-2"
                  title="Open in Google Calendar"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<section className="hero-card"><p className="insight-chip">Calendar</p><h1 className="hero-title">Loading...</h1></section>}>
      <CalendarPageContent />
    </Suspense>
  );
}
