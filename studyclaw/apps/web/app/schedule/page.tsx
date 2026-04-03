'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';
import StatusBanner from '../components/status-banner';

type ScheduleEntry = {
  id: string;
  className: string;
  subject: string | null;
  roomNumber: string | null;
  teacherName: string | null;
  startTime: string | null;
  endTime: string | null;
  period: string | null;
  daysOfWeek: string[];
  notes: string | null;
  location: string | null;
};

type ScheduleContext = {
  status: string;
  message: string;
  today: string;
  timezone: string;
  currentClass: ScheduleEntry | null;
  nextClass: ScheduleEntry | null;
  todaySchedule: ScheduleEntry[];
};

type SchedulePayload = {
  entries: ScheduleEntry[];
  currentContext: ScheduleContext;
};

type EntryForm = {
  className: string;
  subject: string;
  roomNumber: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  period: string;
  daysOfWeek: string[];
  notes: string;
  location: string;
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

const EMPTY_FORM: EntryForm = {
  className: '',
  subject: '',
  roomNumber: '',
  teacherName: '',
  startTime: '',
  endTime: '',
  period: '',
  daysOfWeek: ['monday'],
  notes: '',
  location: '',
};

function labelDay(day: string) {
  return day.slice(0, 1).toUpperCase() + day.slice(1);
}

function formatEntryTime(entry: ScheduleEntry) {
  if (entry.startTime && entry.endTime) {
    return `${entry.startTime}–${entry.endTime}`;
  }
  if (entry.period) {
    return entry.period;
  }
  return 'Time not set';
}

export default function SchedulePage() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);

  async function loadSchedule() {
    setLoading(true);
    const response = await apiFetch('/api/schedule');
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to load your schedule.'));
      setLoading(false);
      return;
    }
    setData(payload as SchedulePayload);
    setStatus('');
    setLoading(false);
  }

  useEffect(() => {
    void loadSchedule();
  }, []);

  const weeklyEntries = useMemo(() => {
    const groups = new Map<string, ScheduleEntry[]>();
    for (const day of WEEKDAYS) {
      groups.set(day, []);
    }
    for (const entry of data?.entries ?? []) {
      for (const day of entry.daysOfWeek) {
        if (!groups.has(day)) {
          groups.set(day, []);
        }
        groups.get(day)!.push(entry);
      }
    }
    for (const entries of groups.values()) {
      entries.sort((left, right) => formatEntryTime(left).localeCompare(formatEntryTime(right)));
    }
    return groups;
  }, [data]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function beginEdit(entry: ScheduleEntry) {
    setEditingId(entry.id);
    setForm({
      className: entry.className,
      subject: entry.subject ?? '',
      roomNumber: entry.roomNumber ?? '',
      teacherName: entry.teacherName ?? '',
      startTime: entry.startTime ?? '',
      endTime: entry.endTime ?? '',
      period: entry.period ?? '',
      daysOfWeek: entry.daysOfWeek.length ? entry.daysOfWeek : ['monday'],
      notes: entry.notes ?? '',
      location: entry.location ?? '',
    });
    setStatus('');
  }

  async function saveEntry() {
    setSaving(true);
    const response = await apiFetch(editingId ? `/api/schedule/entries/${editingId}` : '/api/schedule/entries', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify(form),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to save class block.'));
      setSaving(false);
      return;
    }

    resetForm();
    await loadSchedule();
    setSaving(false);
  }

  async function removeEntry(entryId: string) {
    const response = await apiFetch(`/api/schedule/entries/${entryId}`, {
      method: 'DELETE',
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to delete class block.'));
      return;
    }
    if (editingId === entryId) {
      resetForm();
    }
    await loadSchedule();
  }

  return (
    <section className="schedule-page">
      <header className="schedule-page__hero">
        <div>
          <p className="eyebrow">Class scheduler</p>
          <h1 className="section-title">Keep your class timetable where the agent can actually use it.</h1>
          <p className="muted-copy">
            Add class blocks once, then StudyClaw can answer what class you are in, what&apos;s next, and tailor help to the school day you are actually in.
          </p>
        </div>
        <div className="schedule-page__hero-cards">
          <div className="schedule-page__hero-card">
            <span>Current</span>
            <strong>{data?.currentContext.currentClass?.className ?? 'No active class'}</strong>
            <p>{data?.currentContext.message ?? 'Add your first class block to start.'}</p>
          </div>
          <div className="schedule-page__hero-card">
            <span>Tracked classes</span>
            <strong>{data?.entries.length ?? 0}</strong>
            <p>{data?.currentContext.todaySchedule.length ?? 0} classes on {data?.currentContext.today ?? 'today'}</p>
          </div>
        </div>
      </header>

      {loading ? <StatusBanner tone="neutral">Loading your timetable…</StatusBanner> : null}
      {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}

      <section className="schedule-page__grid">
        <section className="schedule-panel schedule-panel--form">
          <div className="section-head">
            <div>
              <p className="eyebrow">{editingId ? 'Edit block' : 'Add class'}</p>
              <h2 className="section-title">{editingId ? 'Update your timetable entry' : 'Build your weekly timetable'}</h2>
            </div>
          </div>

          <div className="schedule-form">
            <div className="schedule-form__grid">
              <label className="schedule-field">
                <span>Class name</span>
                <input value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value }))} placeholder="Algebra II" />
              </label>
              <label className="schedule-field">
                <span>Subject</span>
                <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Math" />
              </label>
              <label className="schedule-field">
                <span>Teacher</span>
                <input value={form.teacherName} onChange={(event) => setForm((current) => ({ ...current, teacherName: event.target.value }))} placeholder="Ms. Rivera" />
              </label>
              <label className="schedule-field">
                <span>Room</span>
                <input value={form.roomNumber} onChange={(event) => setForm((current) => ({ ...current, roomNumber: event.target.value }))} placeholder="204" />
              </label>
              <label className="schedule-field">
                <span>Start</span>
                <input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
              </label>
              <label className="schedule-field">
                <span>End</span>
                <input type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
              </label>
              <label className="schedule-field">
                <span>Period</span>
                <input value={form.period} onChange={(event) => setForm((current) => ({ ...current, period: event.target.value }))} placeholder="Period 3" />
              </label>
              <label className="schedule-field">
                <span>Location</span>
                <input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Science wing" />
              </label>
            </div>

            <div className="schedule-days">
              {WEEKDAYS.map((day) => (
                <label key={day} className={`schedule-days__chip ${form.daysOfWeek.includes(day) ? 'is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.daysOfWeek.includes(day)}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        daysOfWeek: event.target.checked
                          ? Array.from(new Set([...current.daysOfWeek, day]))
                          : current.daysOfWeek.filter((value) => value !== day),
                      }));
                    }}
                  />
                  {labelDay(day)}
                </label>
              ))}
            </div>

            <label className="schedule-field">
              <span>Notes</span>
              <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="Bring calculator on quiz days, sit near lab bench, teacher likes showing work…" />
            </label>

            <div className="task-action-row">
              <button type="button" className="task-action-button task-action-button-primary" disabled={saving} onClick={() => void saveEntry()}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add class'}
              </button>
              {editingId ? (
                <button type="button" className="task-action-button" onClick={resetForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="schedule-panel schedule-panel--sidebar">
          <div className="schedule-now-card">
            <span className="preview-pill">Right now</span>
            <strong>{data?.currentContext.currentClass?.className ?? 'Between classes'}</strong>
            <p>{data?.currentContext.message ?? 'No class context yet.'}</p>
            {data?.currentContext.nextClass ? (
              <div className="schedule-now-card__next">
                <span>Next</span>
                <strong>{data.currentContext.nextClass.className}</strong>
                <p>{data.currentContext.nextClass.startTime ?? data.currentContext.nextClass.period ?? 'Later today'}</p>
              </div>
            ) : null}
          </div>

          <div className="schedule-panel schedule-panel--embedded">
            <div className="section-head">
              <div>
                <p className="eyebrow">Today</p>
                <h2 className="section-title">Today&apos;s classes</h2>
              </div>
            </div>
            {(data?.currentContext.todaySchedule ?? []).length ? (
              <ul className="schedule-today-list">
                {data?.currentContext.todaySchedule.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.className}</strong>
                    <p>{formatEntryTime(entry)}{entry.roomNumber ? ` · Room ${entry.roomNumber}` : ''}{entry.teacherName ? ` · ${entry.teacherName}` : ''}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No classes saved for today yet.</p>
            )}
          </div>
        </aside>
      </section>

      <section className="schedule-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Week view</p>
            <h2 className="section-title">Weekly timetable</h2>
          </div>
          <Link href="/chat" className="ghost-button">Ask schedule questions in chat</Link>
        </div>
        <div className="schedule-week-grid">
          {WEEKDAYS.map((day) => (
            <article key={day} className="schedule-day-column">
              <header>
                <span>{labelDay(day)}</span>
                <strong>{weeklyEntries.get(day)?.length ?? 0}</strong>
              </header>
              {(weeklyEntries.get(day) ?? []).length ? (
                <ul>
                  {weeklyEntries.get(day)!.map((entry) => (
                    <li key={`${day}-${entry.id}`} className="schedule-entry-card">
                      <div>
                        <strong>{entry.className}</strong>
                        <p>{formatEntryTime(entry)}</p>
                        <p>{entry.teacherName ?? 'Teacher not set'}{entry.roomNumber ? ` · Room ${entry.roomNumber}` : ''}</p>
                      </div>
                      <div className="task-action-row">
                        <button type="button" className="task-action-button" onClick={() => beginEdit(entry)}>Edit</button>
                        <button type="button" className="task-action-button task-action-button-danger" onClick={() => void removeEntry(entry.id)}>Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">Open slot.</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
