'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import StatusBanner from '../components/status-banner';

type DashboardTask = {
  id: string;
  title: string;
  type: string;
  status?: string;
  reminder_at: string;
  urgencyLabel: string;
};

type TaskDraft = {
  title: string;
  type: string;
  reminderAt: string;
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

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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

function DashboardPageContent() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState('');
  const [hasSession, setHasSession] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return !!readStoredSession()?.user?.id;
  });
  const [loading, setLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const upcomingExams = buildUpcomingExams(data);

  async function handleGoogleConnect(returnTo: string) {
    try {
      await beginGoogleConnect(returnTo);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  async function loadDashboard(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }

    const response = await apiFetch('/api/dashboard');
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.message || 'Failed to load dashboard');
      if (!options?.silent) {
        setLoading(false);
      }
      return false;
    }

    setData(payload);
    setStatus('');
    if (!options?.silent) {
      setLoading(false);
    }
    return true;
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payloadSession = consumePayloadFromUrl(new URLSearchParams(window.location.search));
    setHasSession((current) => current ?? !!(payloadSession?.user?.id || readStoredSession()?.user?.id));
  }, []);

  useEffect(() => {
    if (!hasSession) return;

    let active = true;

    async function load() {
      if (!active) return;
      await loadDashboard();
    }

    void load();
    const timer = window.setInterval(() => {
      if (active) {
        void loadDashboard({ silent: true });
      }
    }, 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasSession]);

  function beginEditingTask(task: DashboardTask) {
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      type: task.type,
      reminderAt: toLocalDateTimeValue(task.reminder_at),
    });
    setStatus('');
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setTaskDraft(null);
  }

  async function saveTask(taskId: string) {
    if (!taskDraft?.title.trim() || !taskDraft.type.trim() || !taskDraft.reminderAt) {
      setStatus('Title, type, and time are required.');
      return;
    }

    setTaskActionId(taskId);
    const response = await apiFetch(`/api/reminders/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: taskDraft.title.trim(),
        type: taskDraft.type.trim(),
        reminderAt: new Date(taskDraft.reminderAt).toISOString(),
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.message || 'Failed to update task.');
      setTaskActionId(null);
      return;
    }

    cancelEditingTask();
    await loadDashboard({ silent: true });
    setTaskActionId(null);
  }

  async function deleteTask(taskId: string) {
    setTaskActionId(taskId);
    const response = await apiFetch(`/api/reminders/${taskId}`, {
      method: 'DELETE',
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.message || 'Failed to delete task.');
      setTaskActionId(null);
      return;
    }

    if (editingTaskId === taskId) {
      cancelEditingTask();
    }

    await loadDashboard({ silent: true });
    setTaskActionId(null);
  }

  if (hasSession === null) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Dashboard</p>
        <h1 className="hero-title">Loading your student board.</h1>
        <p className="hero-description">Checking your saved session and pulling the latest dashboard state.</p>
      </section>
    );
  }

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

      {loading && !data ? <StatusBanner tone="neutral">Loading your dashboard...</StatusBanner> : null}
      {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}
      {data && !data.onboardingComplete ? (
        <StatusBanner tone="warning">
          Your account is signed in, but setup is not finished yet. Use the quick actions below to finish onboarding and start feeding the dashboard real study data.
        </StatusBanner>
      ) : null}
      {data && !data.integrations.calendarConnected ? (
        <StatusBanner tone="warning">
          <button type="button" className="inline-edit-button" onClick={() => void handleGoogleConnect('/dashboard')}>
            Connect Google Calendar
          </button>{' '}
          to see upcoming events alongside your study priorities.
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
                  {editingTaskId === task.id && taskDraft ? (
                    <div className="task-editor">
                      <input
                        value={taskDraft.title}
                        onChange={(event) =>
                          setTaskDraft((current) => (current ? { ...current, title: event.target.value } : current))
                        }
                        className="task-editor-input"
                        placeholder="Task title"
                      />
                      <div className="task-editor-grid">
                        <input
                          value={taskDraft.type}
                          onChange={(event) =>
                            setTaskDraft((current) => (current ? { ...current, type: event.target.value } : current))
                          }
                          className="task-editor-input"
                          placeholder="Task type"
                        />
                        <input
                          type="datetime-local"
                          value={taskDraft.reminderAt}
                          onChange={(event) =>
                            setTaskDraft((current) => (current ? { ...current, reminderAt: event.target.value } : current))
                          }
                          className="task-editor-input"
                        />
                      </div>
                      <div className="task-action-row">
                        <button
                          type="button"
                          className="task-action-button task-action-button-primary"
                          onClick={() => void saveTask(task.id)}
                          disabled={taskActionId === task.id}
                        >
                          {taskActionId === task.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="task-action-button"
                          onClick={cancelEditingTask}
                          disabled={taskActionId === task.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="task-main">
                        <div>
                          <strong>{task.title}</strong>
                          <span>{task.type} · {task.urgencyLabel}</span>
                        </div>
                        <div className="task-meta-stack">
                          <div className="task-meta">{formatDate(task.reminder_at)}</div>
                          <div className="task-action-row">
                            <button
                              type="button"
                              className="task-action-button"
                              onClick={() => beginEditingTask(task)}
                              disabled={taskActionId === task.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="task-action-button task-action-button-danger"
                              onClick={() => void deleteTask(task.id)}
                              disabled={taskActionId === task.id}
                            >
                              {taskActionId === task.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
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

        <section className="secondary-card">
          <p className="eyebrow">Upcoming Events</p>
          {data?.integrations.googleEmail ? (
            data.calendarEvents.length ? (
              <div className="stack-list">
                {data.calendarEvents.slice(0, 3).map((event) => (
                  <article key={event.id} className="stack-item">
                    <div>
                      <strong>{event.title}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                        {event.startsAt ? formatDate(event.startsAt) : 'Date unavailable'}
                      </p>
                    </div>
                  </article>
                ))}
                <Link href="/calendar" className="ghost-button text-sm mt-2">
                  View Calendar →
                </Link>
              </div>
            ) : (
              <p className="muted-copy">No upcoming events in the next 3 days</p>
            )
          ) : (
            <button type="button" className="ghost-button" onClick={() => void handleGoogleConnect('/dashboard')}>
              Connect Google Calendar →
            </button>
          )}
        </section>
      </section>

      <section className="board-grid">
        <section className="secondary-card">
          <p className="eyebrow">Quick actions</p>
          <h2 className="section-title">Make the board useful</h2>
          <p className="muted-copy">
            The dashboard API already returns a setup path, but this screen was not rendering it. Fresh accounts looked inactive even though the backend had actions ready.
          </p>
          <div className="actions">
            {(data?.quickActions ?? []).map((action) => (
              <Link key={action.href} href={action.href} className="ghost-button">
                {action.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Due soon</p>
          <div className="stack-list">
            {(data?.dueSoon ?? []).length ? (
              data?.dueSoon.map((task) => (
                <article key={task.id} className="stack-item">
                  <div>
                    <strong>{task.title}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>{task.type} · {task.urgencyLabel}</p>
                  </div>
                  <span className="settings-badge">{formatDate(task.reminder_at)}</span>
                </article>
              ))
            ) : (
              <p className="muted-copy">
                No near-term work is connected yet. Finish onboarding, add reminders, or connect calendar data to populate this list.
              </p>
            )}
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

export default function DashboardPage() {
  return <DashboardPageContent />;
}
