'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Reminder = {
  id: string;
  title: string;
  description?: string;
  remind_at: string;
  status: string;
  created_at: string;
};

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDayLabel(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadReminders() {
      try {
        const response = await apiFetch('/api/reminders');
        if (!response.ok) {
          setError('Failed to load reminders.');
          return;
        }

        const data = await response.json();
        setReminders(data.reminders || data || []);
      } catch {
        setError('Connection error.');
      } finally {
        setLoading(false);
      }
    }

    void loadReminders();
  }, []);

  const groupedReminders = useMemo(() => {
    const groups = new Map<string, Reminder[]>();

    reminders
      .slice()
      .sort((left, right) => new Date(left.remind_at).getTime() - new Date(right.remind_at).getTime())
      .forEach((reminder) => {
        const key = formatDayLabel(reminder.remind_at);
        const next = groups.get(key) ?? [];
        next.push(reminder);
        groups.set(key, next);
      });

    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [reminders]);

  const pendingCount = reminders.filter((item) => item.status === 'pending').length;
  const sentCount = reminders.filter((item) => item.status === 'sent').length;

  return (
    <section className="reminders-shell">
      <header className="reminders-header">
        <div>
          <p className="reminders-header__eyebrow">Reminders</p>
          <h1 className="reminders-header__title">Keep every upcoming task and reminder in one clear timeline.</h1>
          <p className="reminders-header__description">
            Review what is coming up, what already fired, and what still needs attention without jumping back into chat.
          </p>
        </div>
        <div className="reminders-header__meta">
          <div className="reminders-header__meta-card">
            <span>Total</span>
            <strong>{reminders.length}</strong>
          </div>
          <div className="reminders-header__meta-card">
            <span>Pending</span>
            <strong>{pendingCount}</strong>
          </div>
          <div className="reminders-header__meta-card">
            <span>Sent</span>
            <strong>{sentCount}</strong>
          </div>
        </div>
      </header>

      <section className="reminders-ribbon">
        <article className="reminders-ribbon__card">
          <span className="preview-pill">Next reminder</span>
          <strong>{reminders[0]?.title || 'Nothing scheduled yet'}</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            {reminders[0] ? formatDate(reminders[0].remind_at) : 'Set reminders from chat and they will appear here.'}
          </p>
        </article>
        <article className="reminders-ribbon__card">
          <span className="preview-pill">Create more</span>
          <strong>Use chat to add reminders naturally</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            Ask StudyClaw to remind you about classes, tests, meetings, or deadlines and it will feed this board automatically.
          </p>
        </article>
      </section>

      <section className="reminders-grid">
        <aside className="reminders-side">
          <section className="reminders-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Quick help</p>
                <h2 className="section-title">How reminders work</h2>
              </div>
            </div>
            <div className="reminders-helper-list">
              <article className="reminders-helper-card">
                <strong>Create reminders in chat</strong>
                <p className="muted-copy">Say what you need to remember and when. StudyClaw will turn it into a scheduled reminder.</p>
              </article>
              <article className="reminders-helper-card">
                <strong>Use this page to review them</strong>
                <p className="muted-copy">This board gives you a cleaner timeline view once reminders already exist.</p>
              </article>
            </div>
            <div className="actions">
              <Link href="/chat" className="primary-link-button">Open Study Chat</Link>
            </div>
          </section>
        </aside>

        <main className="reminders-main">
          {loading ? (
            <section className="reminders-panel reminders-panel--empty">
              <strong>Loading reminders…</strong>
              <p>Pulling your scheduled tasks and reminder history.</p>
            </section>
          ) : error ? (
            <section className="reminders-panel reminders-panel--error">
              <strong>Couldn’t load reminders</strong>
              <p>{error}</p>
            </section>
          ) : !reminders.length ? (
            <section className="reminders-panel reminders-panel--empty">
              <strong>No reminders yet</strong>
              <p>Ask a homework question, add a deadline, or tell your agent to remind you about an exam in <Link href="/chat">Study Chat</Link>.</p>
            </section>
          ) : (
            <div className="reminders-timeline">
              {groupedReminders.map((group) => (
                <section key={group.label} className="reminders-group">
                  <div className="reminders-group__label">{group.label}</div>
                  <div className="reminders-group__items">
                    {group.items.map((reminder) => (
                      <article key={reminder.id} className="reminders-item">
                        <div className="reminders-item__time">
                          <span>{formatDate(reminder.remind_at).split(',').slice(-1)[0]?.trim() || 'Time set'}</span>
                          <small>{reminder.status}</small>
                        </div>
                        <div className="reminders-item__content">
                          <strong>{reminder.title}</strong>
                          {reminder.description ? (
                            <p className="muted-copy" style={{ margin: '6px 0 0' }}>{reminder.description}</p>
                          ) : null}
                          <p className="muted-copy" style={{ margin: '8px 0 0' }}>
                            Scheduled for {formatDate(reminder.remind_at)}
                          </p>
                        </div>
                        <span className={`reminders-status reminders-status--${reminder.status}`}>
                          {reminder.status}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>
      </section>
    </section>
  );
}
