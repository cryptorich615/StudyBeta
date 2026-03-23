'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import StatusBanner from '../components/status-banner';

type DashboardTask = {
  id: string;
  title: string;
  type: string;
  reminder_at: string;
  urgencyLabel: string;
};

type DashboardData = {
  generatedAt: string;
  onboardingComplete: boolean;
  heartbeat: {
    status: string;
    cadenceMinutes: number;
    lastEvaluatedAt: string;
    nextRunAt: string;
    source: string;
    summary: string;
  };
  integrations: {
    calendarConnected: boolean;
    sourceLabel: string;
    googleEmail?: string | null;
  };
  studentAgent?: {
    name: string;
    agent_type: string;
    status: string;
  } | null;
  counts: {
    flashcardSets: number;
    quizzes: number;
    conversations: number;
    knowledgeItems: number;
  };
  todayTasks: DashboardTask[];
  dueSoon: DashboardTask[];
  nextExam: DashboardTask | null;
  recommendations: string[];
  calendarEvents: Array<{
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    htmlLink: string | null;
  }>;
  activityFeed: Array<{
    action_type: string;
    summary: string;
    created_at: string;
  }>;
  quickActions: Array<{ label: string; href: string }>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isExamTask(task: DashboardTask) {
  const examPattern = /exam|midterm|final|quiz|test/i;
  return examPattern.test(task.type) || examPattern.test(task.title);
}

function buildUpcomingExams(data: DashboardData | null) {
  if (!data) return [];

  const seen = new Set<string>();
  const items = [data.nextExam, ...data.todayTasks, ...data.dueSoon]
    .filter((task): task is DashboardTask => !!task && isExamTask(task))
    .filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort((a, b) => new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime());

  return items;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState('');
  const [hasSession, setHasSession] = useState(false);
  const upcomingExams = buildUpcomingExams(data);

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
  }, []);

  useEffect(() => {
    if (!hasSession) return;

    let active = true;

    async function load() {
      const response = await apiFetch('/api/dashboard');
      const payload = await response.json();

      if (!active) return;

      if (!response.ok) {
        setStatus(payload.message || 'Failed to load dashboard');
        return;
      }

      setData(payload);
      setStatus('');
    }

    void load();
    const timer = window.setInterval(() => void load(), 30 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasSession]);

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Dashboard</p>
        <h1 className="hero-title">Sign in to see your live student board.</h1>
        <p className="hero-description">The dashboard ranks real reminders and study signals. It is only useful when it is tied to your session.</p>
        <div className="actions">
          <Link href="/login" className="primary-link-button">Log in</Link>
          <Link href="/signup" className="ghost-button">Create account</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero-card hero-card-featured">
        <div className="hero-copy">
          <p className="insight-chip">Student bulletin board</p>
          <h1 className="hero-title">Know what to do today without sorting your whole semester by hand.</h1>
          <p className="hero-description">
            StudyClaw ranks today’s pressure, surfaces upcoming exams, and keeps your study board focused on the next work that matters.
          </p>
          {data ? (
            <div className="hero-meta">
              <span className="insight-chip">{data.integrations.sourceLabel}</span>
              {data.studentAgent ? <span className="insight-chip">{data.studentAgent.name} · {data.studentAgent.agent_type}</span> : null}
              <span className="insight-chip">Updated {formatDate(data.generatedAt)}</span>
            </div>
          ) : null}
        </div>
        <div className="hero-actions">
          <div className="metric-grid">
            <div className="metric-tile">
              <strong>{data?.counts.flashcardSets ?? 0}</strong>
              <span>flashcard sets</span>
            </div>
            <div className="metric-tile">
              <strong>{data?.counts.quizzes ?? 0}</strong>
              <span>quizzes</span>
            </div>
            <div className="metric-tile">
              <strong>{data?.counts.knowledgeItems ?? 0}</strong>
              <span>coach knowledge items</span>
            </div>
          </div>
        </div>
      </section>

      {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}
      {data && !data.integrations.calendarConnected ? (
        <StatusBanner tone="warning">
          Connect Google Calendar to see upcoming events alongside your study priorities.
        </StatusBanner>
      ) : null}

      <section className="board-ribbon">
        <article className="ribbon-tile">
          <span className="preview-pill">Focus</span>
          <strong>{data?.todayTasks[0]?.title ?? 'No urgent task'}</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            {data?.todayTasks[0] ? `${data.todayTasks[0].type} · ${data.todayTasks[0].urgencyLabel}` : 'Your board is quiet right now.'}
          </p>
        </article>
        <article className="ribbon-tile">
          <span className="preview-pill">Upcoming exams</span>
          <strong>{upcomingExams[0]?.title ?? 'Nothing scheduled'}</strong>
          <p className="muted-copy" style={{ margin: '6px 0 0' }}>
            {upcomingExams[0] ? formatDate(upcomingExams[0].reminder_at) : 'Add exam reminders to see them here.'}
          </p>
        </article>
      </section>

      <section className="board-grid">
        <section className="priority-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Today</p>
              <h2 className="section-title">Today&apos;s tasks</h2>
            </div>
          </div>
          <ul className="priority-list">
            {(data?.todayTasks ?? []).length ? (
              data?.todayTasks.map((task) => (
                <li key={task.id} className="priority-item">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.type} · {task.urgencyLabel}</span>
                  </div>
                  <div className="task-meta">{formatDate(task.reminder_at)}</div>
                </li>
              ))
            ) : (
              <li className="priority-item priority-empty">
                <div>
                  <strong>No tasks due today</strong>
                  <span>Add reminders or connect more academic inputs to get sharper rankings.</span>
                </div>
              </li>
            )}
          </ul>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Priority messages</p>
          <div className="timeline">
            {(data?.recommendations ?? []).length ? (
              data?.recommendations.map((item) => (
                <div key={item} className="timeline-item">
                  <p className="muted-copy" style={{ margin: 0 }}>{item}</p>
                </div>
              ))
            ) : (
              <p className="muted-copy">No priority messages yet. Add more study inputs to sharpen your board.</p>
            )}
          </div>
        </section>
      </section>

      <section className="board-grid">
        <section className="secondary-card">
          <p className="eyebrow">Due soon</p>
          <div className="stack-list">
            {(data?.dueSoon ?? []).map((task) => (
              <article key={task.id} className="stack-item">
                <div>
                  <strong>{task.title}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>{task.type} · {task.urgencyLabel}</p>
                </div>
                <span className="settings-badge">{formatDate(task.reminder_at)}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Upcoming exams</p>
          {upcomingExams.length ? (
            <div className="stack-list">
              {upcomingExams.map((task) => (
                <article key={task.id} className="stack-item">
                  <div>
                    <strong>{task.title}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>{task.type}</p>
                  </div>
                  <span className="settings-badge">{formatDate(task.reminder_at)}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No upcoming exams are scheduled yet.</p>
          )}
        </section>
      </section>

      <section className="board-grid">
        <section className="secondary-card">
          <p className="eyebrow">Calendar</p>
          <h2 className="section-title">Upcoming Google Calendar events</h2>
          <p className="muted-copy">
            {data?.integrations.googleEmail
              ? `Connected as ${data.integrations.googleEmail}.`
              : 'Connect Google during sign-in to surface live study blocks and exams.'}
          </p>
          <div className="stack-list">
            {(data?.calendarEvents ?? []).length ? (
              data?.calendarEvents.map((event) => (
                <article key={event.id} className="stack-item">
                  <div>
                    <strong>{event.title}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {event.startsAt ? formatDate(event.startsAt) : 'Date unavailable'}
                    </p>
                  </div>
                  {event.htmlLink ? (
                    <Link href={event.htmlLink} target="_blank" rel="noreferrer" className="ghost-button">
                      Open
                    </Link>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="muted-copy">No upcoming Google Calendar events are available yet.</p>
            )}
          </div>
        </section>
      </section>
    </>
  );
}
