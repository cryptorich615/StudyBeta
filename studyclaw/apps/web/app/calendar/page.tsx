'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, beginGoogleConnect, readApiPayload } from '../../lib/api';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import { readStoredSession } from '../../lib/session';

type ConnectionStatus = 'not_connected' | 'connecting' | 'connected' | 'reconnect_required' | 'disconnected';
type CalendarView = 'month' | 'week';

type GoogleStatusPayload = {
  status?: 'not_connected' | 'connected' | 'reconnect_required';
  connected?: boolean;
  needsReconnect?: boolean;
  googleEmail?: string | null;
  account?: string | null;
  error?: string | null;
  lastSyncAt?: string | null;
};

type CalendarEvent = {
  id: string;
  title: string;
  description?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  htmlLink: string | null;
  source: 'studyclaw' | 'google';
  sourceLabel: string;
  eventType?: string | null;
  metadata?: Record<string, unknown>;
};

type NativeEventPayload = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  eventType: 'class' | 'assignment' | 'exam' | 'personal';
};

const EVENT_TYPE_LABELS: Record<NativeEventPayload['eventType'], string> = {
  class: 'Class',
  assignment: 'Assignment',
  exam: 'Exam',
  personal: 'Personal',
};

function startOfDay(value: Date) {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(value: Date, amount: number) {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function startOfWeek(value: Date) {
  const copy = startOfDay(value);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(copy, diff);
}

function startOfMonthGrid(value: Date) {
  const start = new Date(value.getFullYear(), value.getMonth(), 1);
  return startOfWeek(start);
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function sameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function formatDateLabel(value: Date) {
  return value.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeLabel(value: string | null) {
  if (!value) {
    return 'All day';
  }

  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTimeLabel(value: string | null) {
  if (!value) {
    return 'Time not set';
  }

  const date = new Date(value);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toLocalDateTimeValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function emptyDraft(date?: Date): NativeEventPayload {
  const start = date ? new Date(date) : new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    title: '',
    description: '',
    startsAt: toLocalDateTimeValue(start),
    endsAt: toLocalDateTimeValue(end),
    eventType: 'personal',
  };
}

function normalizeGoogleEvents(input: unknown): CalendarEvent[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((event: any) => ({
    id: event.id,
    title: event.title ?? 'Untitled event',
    description: null,
    startsAt: event.startsAt ?? null,
    endsAt: event.endsAt ?? null,
    htmlLink: event.htmlLink ?? null,
    source: 'google',
    sourceLabel: 'Google Calendar',
    eventType: 'google',
    metadata: {},
  }));
}

function normalizeNativeEvents(input: unknown): CalendarEvent[] {
  const events = input && typeof input === 'object' && Array.isArray((input as { events?: unknown[] }).events)
    ? (input as { events: any[] }).events
    : [];

  return events.map((event) => ({
    id: event.id,
    title: event.title ?? 'Untitled event',
    description: event.description ?? null,
    startsAt: event.startsAt ?? null,
    endsAt: event.endsAt ?? null,
    htmlLink: null,
    source: 'studyclaw',
    sourceLabel: 'StudyClaw Calendar',
    eventType: event.eventType ?? 'personal',
    metadata: event.metadata ?? {},
  }));
}

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((left, right) => {
    const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.title.localeCompare(right.title);
  });
}

function groupedEventsForDate(events: CalendarEvent[], date: Date) {
  return events.filter((event) => event.startsAt && sameDay(new Date(event.startsAt), date));
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((index) => (
        <div key={index} className="animate-pulse rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)]/80 p-4">
          <div className="mb-2 h-4 w-40 rounded bg-[color:var(--line)]" />
          <div className="h-3 w-28 rounded bg-[color:var(--line)]" />
        </div>
      ))}
    </div>
  );
}

function CalendarPageContent() {
  const searchParams = useSearchParams();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [nativeEvents, setNativeEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('not_connected');
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleMeta, setGoogleMeta] = useState<GoogleStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [view, setView] = useState<CalendarView>('month');
  const [cursorDate, setCursorDate] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NativeEventPayload>(emptyDraft());

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

  const allEvents = sortEvents([...nativeEvents, ...googleEvents]);
  const upcomingEvents = allEvents.filter((event) => !event.startsAt || new Date(event.startsAt).getTime() >= Date.now() - 12 * 60 * 60 * 1000);
  const googleConnected = connectionStatus === 'connected';
  const needsReconnect = connectionStatus === 'reconnect_required';

  async function loadGoogleStatus() {
    const response = await apiFetch('/api/google');
    const data = (await readApiPayload(response)) as GoogleStatusPayload;

    if (!response.ok) {
      setConnectionStatus('not_connected');
      setGoogleEmail(null);
      setGoogleMeta(null);
      return;
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
  }

  async function loadCalendarData() {
    if (hasSession !== true) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus('');
    try {
      const [nativeResponse, googleStatusResponse] = await Promise.all([
        apiFetch('/api/events'),
        apiFetch('/api/google'),
      ]);

      const nativePayload = await readApiPayload(nativeResponse);
      const googleStatusPayload = (await readApiPayload(googleStatusResponse)) as GoogleStatusPayload;

      if (!nativeResponse.ok) {
        throw new Error(typeof nativePayload.message === 'string' ? nativePayload.message : 'Failed to load StudyClaw calendar');
      }

      setNativeEvents(normalizeNativeEvents(nativePayload));

      if (googleStatusResponse.ok) {
        setGoogleMeta(googleStatusPayload);
        setGoogleEmail(googleStatusPayload.googleEmail ?? googleStatusPayload.account ?? null);
        const statusValue =
          googleStatusPayload.connected
            ? 'connected'
            : googleStatusPayload.status === 'reconnect_required' || googleStatusPayload.needsReconnect
              ? 'reconnect_required'
              : 'not_connected';
        setConnectionStatus(statusValue);

        if (googleStatusPayload.connected) {
          const googleResponse = await apiFetch('/api/google/calendar?days=21');
          const googlePayload = await readApiPayload(googleResponse);
          if (googleResponse.ok) {
            setGoogleEvents(normalizeGoogleEvents(googlePayload));
          } else {
            setGoogleEvents([]);
            setStatus(typeof googlePayload.message === 'string' ? googlePayload.message : 'Failed to load Google Calendar events');
          }
        } else {
          setGoogleEvents([]);
        }
      } else {
        setConnectionStatus('not_connected');
        setGoogleEmail(null);
        setGoogleMeta(null);
        setGoogleEvents([]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasSession !== null) {
      void loadCalendarData();
    }
  }, [hasSession]);

  async function handleGoogleConnect() {
    try {
      setStatus('');
      setConnectionStatus('connecting');
      await beginGoogleConnect('/calendar');
    } catch (error) {
      setConnectionStatus(needsReconnect ? 'reconnect_required' : 'not_connected');
      setStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadCalendarData();
    setRefreshing(false);
  }

  function openCreateModal(date?: Date) {
    setEditingEventId(null);
    setDraft(emptyDraft(date));
    setModalOpen(true);
  }

  function openEditModal(event: CalendarEvent) {
    if (event.source !== 'studyclaw') {
      return;
    }

    setEditingEventId(event.id);
    setDraft({
      title: event.title,
      description: event.description ?? '',
      startsAt: event.startsAt ? toLocalDateTimeValue(event.startsAt) : toLocalDateTimeValue(new Date()),
      endsAt: event.endsAt ? toLocalDateTimeValue(event.endsAt) : '',
      eventType: (event.eventType as NativeEventPayload['eventType']) || 'personal',
    });
    setModalOpen(true);
  }

  async function saveEvent() {
    if (!draft.title.trim()) {
      setStatus('Event title is required.');
      return;
    }

    if (!draft.startsAt) {
      setStatus('Start time is required.');
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      const response = await apiFetch(editingEventId ? `/api/events/${editingEventId}` : '/api/events', {
        method: editingEventId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          startsAt: new Date(draft.startsAt).toISOString(),
          endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
          eventType: draft.eventType,
        }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'Failed to save event');
      }

      setModalOpen(false);
      setEditingEventId(null);
      setDraft(emptyDraft());
      await loadCalendarData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save event');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (!editingEventId) {
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      const response = await apiFetch(`/api/events/${editingEventId}`, { method: 'DELETE' });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'Failed to delete event');
      }

      setModalOpen(false);
      setEditingEventId(null);
      setDraft(emptyDraft());
      await loadCalendarData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete event');
    } finally {
      setSaving(false);
    }
  }

  function shiftCursor(direction: 'prev' | 'next') {
    const delta = direction === 'next' ? 1 : -1;
    if (view === 'month') {
      setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
      return;
    }

    setCursorDate((current) => addDays(current, delta * 7));
  }

  const monthStart = startOfMonthGrid(cursorDate);
  const monthCells = Array.from({ length: 42 }, (_, index) => addDays(monthStart, index));
  const weekStart = startOfWeek(cursorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  if (hasSession === null) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Calendar</p>
        <h1 className="hero-title">Loading your calendar.</h1>
        <p className="hero-description">Checking your session and available calendar sources.</p>
      </section>
    );
  }

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Calendar</p>
        <h1 className="hero-title">Sign in to use StudyClaw Calendar.</h1>
        <p className="hero-description">StudyClaw Calendar is available for every account, and Google users can layer their external calendar on top.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {showSuccess ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Google Calendar connected. StudyClaw is now combining Google events with your native calendar.
        </div>
      ) : null}

      {status ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {status}
        </div>
      ) : null}

      <header className="hero-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="insight-chip">Calendar</p>
            <h1 className="hero-title">Plan with StudyClaw Calendar first, then layer Google on top if you have it.</h1>
            <p className="hero-description">
              Email and password users get a full in-app calendar by default. Google users keep their Google sync and see both sources together.
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-1.5">StudyClaw events: {nativeEvents.length}</span>
              <span className="rounded-full border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-1.5">
                Google: {googleConnected ? (googleEmail || 'Connected') : needsReconnect ? 'Reconnect needed' : 'Not connected'}
              </span>
            </div>
          </div>

          <div className="grid min-w-[280px] gap-3 sm:grid-cols-3 lg:w-[360px]">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Native</span>
              <div className="mt-2 text-2xl font-semibold">{nativeEvents.length}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">StudyClaw calendar events in your workspace.</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Google</span>
              <div className="mt-2 text-2xl font-semibold">{googleEvents.length}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">{googleConnected ? 'Google events merged in.' : 'Optional external calendar layer.'}</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">View</span>
              <div className="mt-2 text-2xl font-semibold capitalize">{view}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">Switch between month and week planning.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-4 rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ghost-button" onClick={() => shiftCursor('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-[180px] text-lg font-semibold">
                {view === 'month'
                  ? cursorDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
                  : `${formatDateLabel(weekDays[0])} - ${formatDateLabel(weekDays[6])}`}
              </div>
              <button type="button" className="ghost-button" onClick={() => shiftCursor('next')}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--panel-2)] p-1">
                <button
                  type="button"
                  onClick={() => setView('month')}
                  className={`rounded-full px-3 py-1.5 text-sm ${view === 'month' ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}
                >
                  Month
                </button>
                <button
                  type="button"
                  onClick={() => setView('week')}
                  className={`rounded-full px-3 py-1.5 text-sm ${view === 'week' ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}
                >
                  Week
                </button>
              </div>
              <button type="button" className="ghost-button" onClick={() => void handleRefresh()} disabled={refreshing || loading}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={() => openCreateModal()} className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white">
                <Plus className="h-4 w-4" />
                Add event
              </button>
            </div>
          </div>

          {loading ? (
            <LoadingSkeleton />
          ) : view === 'month' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                  <div key={label} className="py-2">{label}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {monthCells.map((date) => {
                  const eventsForDate = groupedEventsForDate(allEvents, date);
                  const isToday = sameDay(date, new Date());
                  const inMonth = sameMonth(date, cursorDate);

                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      onClick={() => openCreateModal(date)}
                      className={`min-h-[120px] rounded-2xl border p-3 text-left transition ${inMonth ? 'border-[color:var(--line)] bg-[color:var(--panel-2)]' : 'border-transparent bg-[color:var(--panel)]/60 text-[color:var(--muted)]'} ${isToday ? 'ring-2 ring-[color:var(--accent)]' : ''}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold">{date.getDate()}</span>
                        {eventsForDate.length ? (
                          <span className="rounded-full bg-[color:var(--accent)]/12 px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">
                            {eventsForDate.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {eventsForDate.slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            className={`truncate rounded-full px-2 py-1 text-xs ${event.source === 'google' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'}`}
                            onClick={(eventClick) => {
                              eventClick.stopPropagation();
                              openEditModal(event);
                            }}
                          >
                            {event.title}
                          </div>
                        ))}
                        {eventsForDate.length > 3 ? (
                          <div className="text-xs text-[color:var(--muted)]">+{eventsForDate.length - 3} more</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-7">
              {weekDays.map((date) => {
                const eventsForDate = groupedEventsForDate(allEvents, date);
                return (
                  <div key={date.toISOString()} className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-3">
                    <button type="button" onClick={() => openCreateModal(date)} className="mb-3 w-full text-left">
                      <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{date.toLocaleDateString([], { weekday: 'short' })}</div>
                      <div className="mt-1 text-lg font-semibold">{date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                    </button>
                    <div className="space-y-2">
                      {eventsForDate.length ? eventsForDate.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => openEditModal(event)}
                          className={`w-full rounded-2xl border px-3 py-2 text-left ${event.source === 'google' ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'}`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">{event.sourceLabel}</div>
                          <div className="mt-1 text-sm font-semibold">{event.title}</div>
                          <div className="mt-1 text-xs text-[color:var(--muted)]">{formatTimeLabel(event.startsAt)}</div>
                        </button>
                      )) : (
                        <div className="rounded-2xl border border-dashed border-[color:var(--line)] px-3 py-4 text-sm text-[color:var(--muted)]">
                          No events yet
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Sources</p>
                <h2 className="section-title">Calendar connections</h2>
              </div>
              <CalendarDays className="h-5 w-5 text-[color:var(--muted)]" />
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong>StudyClaw Calendar</strong>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">Available for every account by default.</p>
                  </div>
                  <span className="settings-badge is-live">Active</span>
                </div>
                <p className="mt-3 text-sm text-[color:var(--muted)]">{nativeEvents.length} native events tracked.</p>
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong>Google Calendar</strong>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">
                      {googleConnected
                        ? googleEmail || 'Connected'
                        : needsReconnect
                          ? 'Reconnect needed'
                          : 'Optional calendar layer'}
                    </p>
                  </div>
                  <span className={`settings-badge ${googleConnected ? 'is-live' : ''}`}>
                    {googleConnected ? 'Connected' : needsReconnect ? 'Reconnect' : 'Optional'}
                  </span>
                </div>
                {googleMeta?.error ? (
                  <p className="mt-3 text-sm text-[color:var(--muted)]">Connection detail: {googleMeta.error}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="ghost-button" onClick={() => void handleGoogleConnect()}>
                    {googleConnected || needsReconnect ? 'Reconnect Google' : 'Connect Google'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Agenda</p>
                <h2 className="section-title">Upcoming events</h2>
              </div>
            </div>

            {loading ? (
              <LoadingSkeleton />
            ) : upcomingEvents.length ? (
              <div className="mt-4 space-y-3">
                {upcomingEvents.slice(0, 8).map((event) => (
                  <article key={`${event.source}-${event.id}`} className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${event.source === 'google' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'}`}>
                            {event.sourceLabel}
                          </span>
                          {event.eventType && event.source === 'studyclaw' ? (
                            <span className="text-xs text-[color:var(--muted)]">
                              {EVENT_TYPE_LABELS[(event.eventType as NativeEventPayload['eventType']) || 'personal'] || event.eventType}
                            </span>
                          ) : null}
                        </div>
                        <strong className="mt-2 block">{event.title}</strong>
                        <p className="mt-1 text-sm text-[color:var(--muted)]">
                          {formatDateTimeLabel(event.startsAt)}
                          {event.endsAt ? ` - ${formatTimeLabel(event.endsAt)}` : ''}
                        </p>
                        {event.description ? (
                          <p className="mt-2 text-sm text-[color:var(--muted)]">{event.description}</p>
                        ) : null}
                      </div>
                      {event.source === 'google' && event.htmlLink ? (
                        <a href={event.htmlLink} target="_blank" rel="noreferrer" className="ghost-button">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : (
                        <button type="button" className="ghost-button" onClick={() => openEditModal(event)} disabled={event.source !== 'studyclaw'}>
                          {event.source === 'studyclaw' ? 'Edit' : 'View'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center">
                <strong>No upcoming events yet</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">Add your first StudyClaw event to start planning around real dates and time blocks.</p>
                <button type="button" onClick={() => openCreateModal()} className="mt-4 ghost-button">
                  Create your first event
                </button>
              </div>
            )}
          </section>
        </aside>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-xl rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">{editingEventId ? 'Edit event' : 'New event'}</p>
                <h2 className="section-title">{editingEventId ? 'Update a StudyClaw calendar event' : 'Add a StudyClaw calendar event'}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="form-field md:col-span-2">
                <span>Title</span>
                <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Chemistry review block" />
              </label>

              <label className="form-field">
                <span>Start time</span>
                <input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))} />
              </label>

              <label className="form-field">
                <span>End time</span>
                <input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft((current) => ({ ...current, endsAt: event.target.value }))} />
              </label>

              <label className="form-field">
                <span>Event type</span>
                <select value={draft.eventType} onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value as NativeEventPayload['eventType'] }))}>
                  {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="form-field md:col-span-2">
                <span>Description</span>
                <textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Exam chapter coverage, room, prep notes, or context for the agent." />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                {editingEventId ? (
                  <button type="button" className="ghost-button" onClick={() => void deleteEvent()} disabled={saving}>
                    <Trash2 className="mr-2 inline h-4 w-4" />
                    Delete event
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ghost-button" onClick={() => setModalOpen(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" onClick={() => void saveEvent()} disabled={saving}>
                  {saving ? 'Saving...' : editingEventId ? 'Save changes' : 'Create event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
