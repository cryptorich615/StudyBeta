'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calendar as CalendarIcon, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import { readStoredSession } from '../../lib/session';

type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  htmlLink: string | null;
};

type ConnectionStatus = 'not_connected' | 'connecting' | 'connected' | 'reconnect_required' | 'disconnected';
type GoogleStatusPayload = {
  status?: 'not_connected' | 'connected' | 'reconnect_required';
  connected?: boolean;
  needsReconnect?: boolean;
  googleEmail?: string | null;
  account?: string | null;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  lastSyncAt?: string | null;
  error?: string | null;
};

function dedupeEvents(events: CalendarEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.id}|${event.startsAt ?? ''}|${event.endsAt ?? ''}|${event.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isAllDayEvent(dateTime: string | null) {
  return !!dateTime && /^\d{4}-\d{2}-\d{2}$/.test(dateTime);
}

function formatEventDateTime(dateTime: string | null) {
  if (!dateTime) return 'All day';
  if (isAllDayEvent(dateTime)) {
    const [year, month, day] = dateTime.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
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
  if (isAllDayEvent(dateTime)) return 'All day';
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('not_connected');
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleMeta, setGoogleMeta] = useState<GoogleStatusPayload | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const searchParams = useSearchParams();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payloadSession = consumePayloadFromUrl(searchParams);
    setHasSession((current) => current ?? !!(payloadSession?.user?.id || readStoredSession()?.user?.id));

    if (searchParams.get('connected') === 'true' || searchParams.get('google') === 'connected') {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    }
  }, [searchParams]);

  const connected = connectionStatus === 'connected';
  const needsReconnect = connectionStatus === 'reconnect_required';

  async function loadStatus() {
    if (hasSession !== true) return;
    try {
      const res = await apiFetch('/api/google');
      const data = (await res.json()) as GoogleStatusPayload;
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load Google status');
      }

      setGoogleMeta(data);
      setGoogleEmail(data.googleEmail ?? data.account ?? null);
      setConnectionStatus(
        data.connected
          ? 'connected'
          : data.status === 'reconnect_required' || data.needsReconnect
            ? 'reconnect_required'
            : 'not_connected'
      );

      if (!data.connected && (searchParams.get('connected') === 'true' || searchParams.get('google') === 'connected')) {
        setError(
          data.error === 'missing_calendar_scope'
            ? 'Google sign-in finished, but Calendar permission was not granted. Reconnect Google Calendar and allow calendar access.'
            : 'Google returned to StudyClaw, but Calendar is not fully connected yet. Try reconnecting once.'
        );
      } else if (data.connected) {
        setError('');
      }
    } catch (statusError) {
      setGoogleMeta(null);
      setGoogleEmail(null);
      setConnectionStatus('not_connected');
      setError(
        statusError instanceof Error ? statusError.message : 'Failed to check Google Calendar connection'
      );
    }
  }

  async function loadEvents() {
    if (hasSession !== true) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/google/calendar?days=14');
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 400 && (data.error === 'not_connected' || data.error === 'reconnect_required' || data.connected === false)) {
          setConnectionStatus(data.status === 'reconnect_required' ? 'reconnect_required' : 'not_connected');
          setGoogleMeta((current) => ({
            ...(current ?? {}),
            status: data.status,
            connected: false,
            needsReconnect: data.status === 'reconnect_required',
            error: typeof data.error === 'string' ? data.error : null,
          }));
          setError(typeof data.message === 'string' ? data.message : '');
          setLoading(false);
          return;
        }
        throw new Error(data.message || 'Failed to fetch');
      }
      const data = await res.json();
      setEvents(Array.isArray(data) ? dedupeEvents(data) : []);
      setConnectionStatus('connected');
      setGoogleMeta((current) => ({
        ...(current ?? {}),
        status: 'connected',
        connected: true,
        lastSyncAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    try {
      setConnectionStatus('connecting');
      await beginGoogleConnect('/calendar');
    } catch (nextError) {
      setConnectionStatus(needsReconnect ? 'reconnect_required' : 'not_connected');
      setError(nextError instanceof Error ? nextError.message : 'Failed to start Google connection');
    }
  }

  async function handleDisconnect() {
    setRefreshing(true);
    setError('');
    try {
      const res = await apiFetch('/api/google/disconnect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to disconnect Google');
      }
      setEvents([]);
      setGoogleEmail(null);
      setConnectionStatus('disconnected');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to disconnect Google');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }

  useEffect(() => {
    if (hasSession === true) {
      void loadStatus();
    } else if (hasSession === false) {
      setLoading(false);
    }
  }, [hasSession]);

  useEffect(() => {
    if (connected) {
      void loadEvents();
    } else if (connectionStatus !== 'connecting') {
      setLoading(false);
    }
  }, [connected, connectionStatus]);

  const connectionLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting'
        : connectionStatus === 'reconnect_required'
          ? 'Reconnect needed'
          : connectionStatus === 'disconnected'
            ? 'Disconnected'
            : 'Not connected';
  const connectionMessage =
    connectionStatus === 'connected'
      ? 'Google Calendar is connected. StudyClaw can read your schedule and help with AI scheduling.'
      : connectionStatus === 'connecting'
        ? 'Finishing the Google connection now.'
        : connectionStatus === 'reconnect_required'
          ? 'Google access expired or changed. Reconnect to keep calendar-aware planning working.'
          : connectionStatus === 'disconnected'
            ? 'Google Calendar was disconnected. You can reconnect any time.'
            : 'Connect once and StudyClaw can sync study sessions and deadlines with your real schedule.';

  if (hasSession === null) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Calendar</p>
        <h1 className="hero-title">Loading your calendar.</h1>
        <p className="hero-description">Checking your session and Google connection.</p>
      </section>
    );
  }

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
    <section className="study-calendar-shell">
      {showSuccess ? (
        <div className="study-calendar-banner study-calendar-banner--success">
          <CheckCircle className="w-4 h-4" />
          Google Calendar connected. AI scheduling and calendar-aware planning are ready.
        </div>
      ) : null}

      <header className="study-calendar-header">
        <div>
          <p className="study-calendar-header__eyebrow">Calendar</p>
          <h1 className="study-calendar-header__title">See classes, study blocks, and deadlines in one calm agenda.</h1>
          <p className="study-calendar-header__description">
            Bring Google Calendar into StudyClaw so the rest of your planning stays tied to your real schedule.
          </p>
        </div>
        <div className="study-calendar-header__meta">
          <div className="study-calendar-header__meta-card">
            <span>Status</span>
            <strong>{connectionLabel}</strong>
          </div>
          <div className="study-calendar-header__meta-card">
            <span>Events</span>
            <strong>{events.length}</strong>
          </div>
          <div className="study-calendar-header__meta-card">
            <span>Calendar</span>
            <strong>{googleEmail || 'Not linked yet'}</strong>
          </div>
        </div>
      </header>

      <section className="study-calendar-ribbon">
        <article className="study-calendar-ribbon__card">
          <span className="preview-pill">Next up</span>
          <strong>{events[0]?.title || 'No upcoming events yet'}</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            {events[0]?.startsAt ? formatEventDateTime(events[0].startsAt) : 'Connect your calendar or wait for upcoming events to appear.'}
          </p>
        </article>
        <article className="study-calendar-ribbon__card">
          <span className="preview-pill">Connection</span>
          <strong>{connected ? 'Google Calendar is active' : needsReconnect ? 'Reconnect Google Calendar' : 'Calendar not connected'}</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            {connected
              ? 'Refresh anytime to pull the latest events into your agenda.'
              : needsReconnect
                ? 'Reconnect to let StudyClaw keep reading and scheduling calendar events.'
                : 'Connect your Google account to pull classes, exams, and study blocks.'}
          </p>
        </article>
      </section>

      <section className="study-calendar-grid">
        <aside className="study-calendar-side">
          <section className="study-calendar-panel">
            <div className="study-calendar-panel__head">
              <div>
                <p className="eyebrow">Status</p>
                <h2 className="section-title">Connection</h2>
              </div>
              {connected ? <span className="settings-badge is-live">Live</span> : <span className="settings-badge">{needsReconnect ? 'Reconnect' : 'Needs setup'}</span>}
            </div>

            <div className="study-calendar-status-card">
              <CalendarIcon className="study-calendar-status-card__icon" />
              <div>
                <strong>
                  {connected
                    ? 'Google Calendar connected'
                    : needsReconnect
                      ? 'Reconnect Google Calendar'
                      : connectionStatus === 'disconnected'
                        ? 'Google Calendar disconnected'
                        : 'Google Calendar not connected'}
                </strong>
                <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                  {connectionMessage}
                </p>
                <p className="muted-copy" style={{ margin: '8px 0 0' }}>
                  Allow AI scheduling. Sync study sessions and deadlines.
                </p>
                {googleMeta?.error ? (
                  <p className="muted-copy" style={{ margin: '8px 0 0', color: 'var(--danger)' }}>
                    Connection detail: {googleMeta.error}
                  </p>
                ) : null}
                {googleMeta?.lastSyncAt ? (
                  <p className="muted-copy" style={{ margin: '8px 0 0' }}>
                    Last checked: {new Date(googleMeta.lastSyncAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="actions">
              {connected ? (
                <>
                  <button onClick={handleRefresh} disabled={refreshing || loading}>
                    {refreshing ? 'Refreshing...' : 'Refresh calendar'}
                  </button>
                  <button onClick={handleDisconnect} disabled={refreshing} className="ghost-button">
                    {refreshing ? 'Disconnecting...' : 'Disconnect Google'}
                  </button>
                </>
              ) : (
                <button onClick={handleConnect} disabled={connectionStatus === 'connecting'}>
                  {connectionStatus === 'connecting'
                    ? 'Connecting Google...'
                    : needsReconnect
                      ? 'Reconnect Google'
                      : 'Connect Google Calendar'}
                </button>
              )}
            </div>
          </section>

          <section className="study-calendar-panel">
            <div className="study-calendar-panel__head">
              <div>
                <p className="eyebrow">Planning notes</p>
                <h2 className="section-title">How to use this</h2>
              </div>
            </div>
            <div className="study-calendar-helper-list">
              <article className="study-calendar-helper-card">
                <strong>See what is actually coming</strong>
                <p className="muted-copy">Use the agenda to spot class meetings, exams, and busy days before you build study plans.</p>
              </article>
              <article className="study-calendar-helper-card">
                <strong>Let StudyClaw schedule with context</strong>
                <p className="muted-copy">When Google Calendar is connected, the agent can use your real schedule while planning study sessions and deadlines.</p>
              </article>
            </div>
          </section>
        </aside>

        <main className="study-calendar-main">
          {error ? (
            <div className="study-calendar-banner study-calendar-banner--error">
              {error}
            </div>
          ) : null}

          <section className="study-calendar-panel study-calendar-panel--agenda">
            <div className="study-calendar-panel__head">
              <div>
                <p className="eyebrow">Agenda</p>
                <h2 className="section-title">Upcoming events</h2>
              </div>
              {connected ? (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing || loading}
                  className="ghost-button"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              ) : null}
            </div>

            {loading ? (
              <div className="study-calendar-loading">
                <LoadingSkeleton />
              </div>
            ) : !connected ? (
              <div className="study-calendar-empty">
                <CalendarIcon className="study-calendar-empty__icon" />
                <strong>{needsReconnect ? 'Reconnect Google Calendar to restore your agenda' : 'Connect Google Calendar to start your agenda'}</strong>
                <p>
                  {needsReconnect
                    ? 'Google access needs to be refreshed before StudyClaw can read your upcoming events again.'
                    : 'Once connected, upcoming classes, deadlines, and study blocks will appear here automatically.'}
                </p>
                <button onClick={handleConnect} className="primary-link-button">
                  {needsReconnect ? 'Reconnect Google' : 'Connect Google Calendar'}
                </button>
              </div>
            ) : events.length === 0 ? (
              <div className="study-calendar-empty">
                <CalendarIcon className="study-calendar-empty__icon" />
                <strong>No upcoming events in the next 14 days</strong>
                <p>Your calendar is connected, but there is nothing scheduled in the current window yet.</p>
              </div>
            ) : (
              <div className="study-calendar-agenda">
                {events.map((event) => (
                  <article key={event.id} className="study-calendar-event">
                    <div className="study-calendar-event__time">
                      <span>{event.startsAt ? formatEventTime(event.startsAt) : 'All day'}</span>
                      <small>{event.startsAt ? formatEventDateTime(event.startsAt).split(',')[0] : 'Date TBD'}</small>
                    </div>
                    <div className="study-calendar-event__content">
                      <strong>{event.title || 'Untitled Event'}</strong>
                      <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                        {formatEventDateTime(event.startsAt)}
                        {event.endsAt ? ` – ${formatEventTime(event.endsAt)}` : ''}
                      </p>
                    </div>
                    {event.htmlLink ? (
                      <a
                        href={event.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="ghost-button"
                        title="Open in Google Calendar"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </section>
    </section>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<section className="hero-card"><p className="insight-chip">Calendar</p><h1 className="hero-title">Loading...</h1></section>}>
      <CalendarPageContent />
    </Suspense>
  );
}
